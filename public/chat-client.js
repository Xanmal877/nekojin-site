/**
 * nekojin-chat-client.js
 * Multi-provider chat engine: pi Agent (WS) + Claude / OpenAI / xAI / Ollama (proxied fetch)
 */

(function() {
'use strict';

const WS_URL = (location.protocol === 'https:' ? `wss://${location.host}/chat` : `ws://${location.host}/chat`);
const MAX_RECONNECT = 5;

// ── Config ──────────────────────────────────────────────
const CFG = {
  get systemPrompt() { try { return localStorage.getItem('nekojin:systemPrompt') || ''; } catch { return ''; } },
  set systemPrompt(v) { try { localStorage.setItem('nekojin:systemPrompt', v || ''); } catch {} },
  get injectContext() { try { return localStorage.getItem('nekojin:injectContext') === 'true'; } catch { return false; } },
  set injectContext(v) { try { localStorage.setItem('nekojin:injectContext', String(v)); } catch {} },
  get currentProvider() { try { return localStorage.getItem('nekojin:provider') || 'pi'; } catch { return 'pi'; } },
  set currentProvider(v) { try { localStorage.setItem('nekojin:provider', v || 'pi'); } catch {} },
  get currentModel() { try { return localStorage.getItem('nekojin:model:' + CFG.currentProvider) || ''; } catch { return ''; } },
  set currentModel(v) { try { localStorage.setItem('nekojin:model:' + CFG.currentProvider, v || ''); } catch {} },
  get temperature() { try { return parseFloat(localStorage.getItem('nekojin:temperature')) || 0.7; } catch { return 0.7; } },
  set temperature(v) { try { localStorage.setItem('nekojin:temperature', String(v)); } catch {} },
  get maxTokens() { try { return parseInt(localStorage.getItem('nekojin:maxTokens'), 10) || 4096; } catch { return 4096; } },
  set maxTokens(v) { try { localStorage.setItem('nekojin:maxTokens', String(v)); } catch {} },
};

// ── Custom model storage ────────────────────────────────
function getCustomModel(providerId) { try { return localStorage.getItem(`nekojin:customModel:${providerId}`) || ''; } catch { return ''; } }
function setCustomModel(providerId, modelId) { try { localStorage.setItem(`nekojin:customModel:${providerId}`, modelId || ''); } catch {} }

// ── Agent context (README + MEMORY + TASKS) ─────────────
let agentContextText = null;
let agentContextPromise = null;
async function fetchAgentContext() {
  if (agentContextText != null) return agentContextText;
  if (agentContextPromise) return agentContextPromise;
  agentContextPromise = fetch('/api/agent-context')
    .then(r => { if (!r.ok) throw new Error('Failed to load context'); return r.json(); })
    .then(data => {
      const parts = [];
      if (data.readme) parts.push('=== README ===\n' + data.readme);
      if (data.memory) parts.push('=== MEMORY ===\n' + data.memory);
      if (data.tasks) parts.push('=== TASKS ===\n' + data.tasks);
      agentContextText = parts.join('\n\n');
      return agentContextText;
    })
    .catch(() => { agentContextText = ''; return ''; })
    .finally(() => { agentContextPromise = null; });
  return agentContextPromise;
}

async function updateHealthWidget() {
  const el = document.getElementById('health-widget');
  if (!el) return;
  try {
    const r = await fetch('/api/health');
    if (!r.ok) return;
    const data = await r.json();
    el.textContent = data.disk || '--';
    el.className = 'health-widget ' + (data.status || 'ok');
  } catch { el.textContent = '--'; el.className = 'health-widget'; }
}

function validateStoredModel() {
  const prov = PROVIDERS[CFG.currentProvider];
  if (!prov) return;
  const stored = CFG.currentModel;
  if (!stored || stored === 'custom') return;
  // Check if stored model exists in the provider's model list
  const exists = prov.models.some(m => m.id === stored);
  if (!exists) {
    console.warn(`[model] Invalid stored model "${stored}" for ${CFG.currentProvider}, resetting to default "${prov.defaultModel}"`);
    CFG.currentModel = prov.defaultModel;
    currentModel = prov.defaultModel;
  }
}

let cachedTemplates = null;
async function loadTemplates() {
  const sel = document.getElementById('template-select');
  if (!sel) return;
  try {
    const r = await fetch('/api/templates');
    if (!r.ok) return;
    const data = await r.json();
    cachedTemplates = data.templates || [];
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">— No template —</option>';
    for (const t of cachedTemplates) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      sel.appendChild(opt);
    }
    sel.value = currentVal;
  } catch { /* silently fail */ }
}

// ── IndexedDB ───────────────────────────────────────────
const DB_NAME = 'nekojin-chat-v1';
const DB_VERSION = 1;
let dbPromise = null;
function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const store = db.createObjectStore('sessions', { keyPath: 'id' });
        store.createIndex('provider', 'provider', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
  });
  return dbPromise;
}
async function dbTx(store, mode) {
  const db = await getDB();
  return db.transaction(store, mode).objectStore(store);
}
async function listApiSessions() {
  try {
    const store = await dbTx('sessions', 'readonly');
    const req = store.index('updatedAt').openCursor(null, 'prev');
    const out = [];
    return new Promise((resolve) => {
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) { resolve(out); return; }
        out.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => resolve(out);
    });
  } catch { return []; }
}
async function getApiSession(id) {
  try {
    const store = await dbTx('sessions', 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}
async function putApiSession(session) {
  try {
    const store = await dbTx('sessions', 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(session);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch { return false; }
}
async function deleteApiSession(id) {
  try {
    const store = await dbTx('sessions', 'readwrite');
    return new Promise((resolve) => { store.delete(id); resolve(true); });
  } catch { return false; }
}

// ── DOM refs ────────────────────────────────────────────
const els = {};
function cacheEls() {
  const ids = [
    'messages','input','send','status-dot','status-text','conn-banner',
    'session-list','header-title','sidebar','sidebar-overlay','sidebar-toggle',
    'model-picker','model-current','model-popover','file-input','btn-attach','btn-mic',
    'attach-bar','toast','btn-new-chat','btn-settings','btn-clear','btn-save-chat','settings-panel',
    'settings-overlay','btn-close-settings','system-prompt-input','btn-save-prompt',
    'btn-reset-prompt','welcome','stop-btn'
  ];
  for (const id of ids) els[id] = document.getElementById(id);
}

let ws = null, reconnectAttempts = 0, reconnectTimer = null;
let isStreaming = false, streamCount = 0, currentAssistantEl = null;
let activeSessionId = null, activeSessionProvider = null;
let sessionsData = [];
let availableModels = [], currentModel = null;
let pendingAttachments = [], abortCtrl = null;
let wsReady = false;

// ── UI helpers ──────────────────────────────────────────
function setStatus(state, text) {
  const dot = els['status-dot']; const txt = els['status-text'];
  if (dot) dot.className = 'dot ' + state;
  if (txt) txt.textContent = text;
  if (els['conn-banner']) els['conn-banner'].classList.toggle('visible', state === 'offline');
}
function setHeaderTitle(name) {
  const el = els['header-title']; if (!el) return;
  el.textContent = name || 'New Chat';
  document.title = (name || 'New Chat') + ' - pi';
}
function scrollToBottom() { if (els.messages) els.messages.scrollTop = els.messages.scrollHeight; }
function showToast(msg) {
  const t = els.toast; if (!t) return;
  t.textContent = msg; t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 2500);
}
function highlightCode(el) {
  if (!window.Prism || !el) return;
  el.querySelectorAll('pre code[class*="language-"]').forEach(block => {
    try { Prism.highlightElement(block); } catch {}
  });
}
function hideWelcome() { const w = document.getElementById('welcome'); if (w) w.remove(); }
function showWelcome() {
  if (!els.messages) return;
  if (els.messages.querySelector('.aichat-welcome')) return;
  const prov = PROVIDERS[CFG.currentProvider];
  const div = document.createElement('div');
  div.className = 'aichat-welcome'; div.id = 'welcome';
  div.innerHTML = `<h1>${prov?.logo || 'AI'}</h1>
    <p><strong>${prov?.name || 'AI Chat'}</strong> — ${prov?.description || 'Ask me anything.'}</p>
    <div class="quick-actions">
      <button data-prompt="Explain my code to me">Explain code</button>
      <button data-prompt="Refactor this to be cleaner">Refactor</button>
      <button data-prompt="Debug why this isn't working">Debug</button>
      <button data-prompt="Generate a function that">Write function</button>
    </div>`;
  els.messages.appendChild(div);
  div.querySelectorAll('.quick-actions button').forEach(b => {
    b.addEventListener('click', () => { sendUserMessage(b.dataset.prompt); });
  });
}

function createMessage(role, html) {
  if (!els.messages) return null;
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  if (html) el.innerHTML = html;
  els.messages.appendChild(el);
  scrollToBottom();
  return el;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  const yesterday = new Date(now - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], {month:'short', day:'numeric'});
}

// ── Sidebar ─────────────────────────────────────────────
els.sidebarToggle && (els.sidebarToggle.onclick = () => {
  els.sidebar.classList.toggle('open');
  els.sidebarOverlay.style.display = els.sidebar.classList.contains('open') ? 'block' : 'none';
});
els.sidebarOverlay && (els.sidebarOverlay.onclick = () => {
  els.sidebar.classList.remove('open'); els.sidebarOverlay.style.display = 'none';
});

// ── Model picker ────────────────────────────────────────
function populateModels(models) {
  if (models && models.length) {
    availableModels = models;
  }
  if (!availableModels.length && CFG.currentProvider === 'pi') {
    if (els['model-current']) els['model-current'].querySelector('span:first-child').textContent = 'Loading models…';
    return;
  }
  const pop = els['model-popover']; const cur = els['model-current'];
  if (!pop || !cur) return;

  // If pi agent, use server models. Otherwise use provider definition.
  let displayModels = availableModels;
  if (CFG.currentProvider === 'pi') {
    displayModels = availableModels.map(m => ({ ...m, provider: m.provider || 'pi' }));
  } else if (CFG.currentProvider !== 'pi') {
    const prov = PROVIDERS[CFG.currentProvider];
    displayModels = prov ? prov.models.map(m => ({ ...m, provider: prov.id })) : [];
    // Inject stored custom model name into the display
    const customVal = getCustomModel(CFG.currentProvider);
    if (customVal) displayModels = displayModels.map(m => m.id === 'custom' ? { ...m, name: `Custom: ${customVal}` } : m);
  }

  // Update current button text
  const current = displayModels.find(m => m.id === (currentModel || CFG.currentModel));
  const first = displayModels[0];
  const display = current || first;
  if (display) {
    const provName = display.provider ? (PROVIDERS[display.provider]?.name || display.provider) : '';
    const tag = provName ? `<span class="provider-tag">${escapeHtml(provName)}</span>` : '';
    cur.querySelector('span:first-child').innerHTML = `${escapeHtml(display.name || display.id)} ${tag}`;
    if (!currentModel) currentModel = display.id;
  } else if (CFG.currentProvider === 'ollama') {
    cur.querySelector('span:first-child').innerHTML = `Ollama <span class="provider-tag">no models</span>`;
  }

  // Favorites from localStorage: key is "provider:modelId"
  let favorites = [];
  try { favorites = JSON.parse(localStorage.getItem('nekojin:favModels') || '[]'); } catch { favorites = []; }
  function isFav(m) { return favorites.includes(`${m.provider || 'unknown'}:${m.id}`); }

  // Separate favorites
  const favModels = displayModels.filter(isFav);
  const otherModels = displayModels.filter(m => !isFav(m));

  // Build popover grouped by provider (for non-favorites)
  const byProv = {};
  for (const m of otherModels) {
    const p = m.provider || 'unknown';
    if (!byProv[p]) byProv[p] = [];
    byProv[p].push(m);
  }

  function renderModelRow(m) {
    const active = m.id === (currentModel || CFG.currentModel) ? 'active' : '';
    const fav = isFav(m) ? 'fav' : '';
    const caps = [];
    if (m.vision) caps.push('<span class="has-img">vision</span>');
    const key = `${escapeHtml(m.provider || 'unknown')}:${escapeHtml(m.id)}`;
    return `<div class="model-option ${active}" data-id="${escapeHtml(m.id)}" onclick="window._selectModel('${escapeHtml(m.id)}')">
      <span class="model-name">${escapeHtml(m.name || m.id)}</span>
      <span class="cap">${caps.join(' · ')}</span>
      <button class="star-btn ${fav}" onclick="event.stopPropagation(); window._toggleFavorite('${key}')" title="Toggle favorite">★</button>
      <span class="check">✓</span>
    </div>`;
  }

  let html = '';
  // Favorites section at top
  if (favModels.length) {
    html += `<div class="provider-group favorites-group">
      <div class="provider-header open" onclick="window._toggleProvider(this)">
        <span class="provider-name">★ Favorites</span>
        <span class="count">${favModels.length}</span>
        <span class="arrow">▸</span>
      </div>
      <div class="provider-models open">
        ${favModels.map(renderModelRow).join('')}
      </div>
    </div>`;
  }

  for (const [provId, pmodels] of Object.entries(byProv)) {
    const provName = PROVIDERS[provId]?.name || provId;
    const provOpen = pmodels.some(m => m.id === (currentModel || CFG.currentModel)) ? 'open' : '';
    html += `<div class="provider-group">
      <div class="provider-header ${provOpen}" onclick="window._toggleProvider(this)">
        <span class="provider-name">${escapeHtml(provName)}</span>
        <span class="count">${pmodels.length}</span>
        <span class="arrow">▸</span>
      </div>
      <div class="provider-models ${provOpen}">
        ${pmodels.map(renderModelRow).join('')}
      </div>
    </div>`;
  }
  pop.innerHTML = html;
}

window._toggleModelPicker = function() {
  const pop = els['model-popover']; const cur = els['model-current'];
  if (!pop || !cur) return;
  const open = pop.classList.contains('open');
  if (open) { pop.classList.remove('open'); cur.classList.remove('open'); }
  else { pop.classList.add('open'); cur.classList.add('open'); }
};
window._toggleProvider = function(el) {
  el.classList.toggle('open');
  const models = el.nextElementSibling;
  if (models) models.classList.toggle('open');
};
window._toggleFavorite = function(key) {
  let favorites = [];
  try { favorites = JSON.parse(localStorage.getItem('nekojin:favModels') || '[]'); } catch { favorites = []; }
  const idx = favorites.indexOf(key);
  if (idx >= 0) favorites.splice(idx, 1);
  else favorites.push(key);
  try { localStorage.setItem('nekojin:favModels', JSON.stringify(favorites)); } catch {}
  populateModels(availableModels);
  showToast(idx >= 0 ? 'Removed from favorites' : 'Added to favorites');
};
window._selectModel = function(id) {
  if (!id) return;
  const modelDef = PROVIDERS[CFG.currentProvider]?.models.find(m => m.id === id);
  if (modelDef?.custom) {
    const stored = getCustomModel(CFG.currentProvider);
    const input = prompt('Enter model ID (e.g. gpt-4o, claude-sonnet-4-5):', stored || '');
    if (!input || !input.trim()) return;
    setCustomModel(CFG.currentProvider, input.trim());
  }
  currentModel = id; CFG.currentModel = id;
  populateModels(availableModels);
  const pop = els['model-popover']; const cur = els['model-current'];
  if (pop) pop.classList.remove('open');
  if (cur) cur.classList.remove('open');
  showToast('Switched to ' + (PROVIDERS[CFG.currentProvider]?.models.find(m => m.id === id)?.name || id));

  // If pi agent, tell server
  if (CFG.currentProvider === 'pi' && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'set_model', modelId: id }));
  }
};

document.addEventListener('click', (e) => {
  const mp = els['model-picker']; if (!mp) return;
  if (!mp.contains(e.target)) {
    if (els['model-popover']) els['model-popover'].classList.remove('open');
    if (els['model-current']) els['model-current'].classList.remove('open');
  }
});

// ── File upload (images → base64, text → server upload) ─
function processFile(file) {
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      pendingAttachments.push({ type: 'image', name: file.name, data: e.target.result, mimeType: file.type });
      renderAttachments();
    };
    reader.readAsDataURL(file);
  } else {
    const body = new FormData(); body.append('file', file);
    fetch('/upload-chat-file', { method: 'POST', body })
      .then(r => r.json())
      .then(d => {
        pendingAttachments.push({ type: 'file', name: file.name, path: d.path, size: d.size });
        renderAttachments();
      })
      .catch(err => showToast('Upload failed: ' + (err.message || 'unknown')));
  }
}
function renderAttachments() {
  if (!els['attach-bar']) return;
  els['attach-bar'].innerHTML = '';
  if (!pendingAttachments.length) {
    if (els['btn-attach']) els['btn-attach'].classList.remove('has-files');
    return;
  }
  if (els['btn-attach']) els['btn-attach'].classList.add('has-files');
  for (const att of pendingAttachments) {
    const chip = document.createElement('div'); chip.className = 'attach-chip';
    if (att.type === 'image') {
      chip.innerHTML = `<img class="chip-img" src="${att.data}"><span>${escapeHtml(att.name)}</span><button class="remove">×</button>`;
    } else {
      chip.innerHTML = `<span>📄 ${escapeHtml(att.name)}</span><button class="remove">×</button>`;
    }
    chip.querySelector('.remove').onclick = () => {
      pendingAttachments = pendingAttachments.filter(a => a !== att); renderAttachments();
    };
    els['attach-bar'].appendChild(chip);
  }
}

// ── Session list render ─────────────────────────────────
async function refreshSessionList() {
  // Merge pi server sessions + local api sessions
  const piSessions = sessionsData || [];
  const apiSessions = await listApiSessions();
  const all = [];
  for (const s of piSessions) all.push({ ...s, _source: 'pi' });
  for (const s of apiSessions) all.push({ ...s, _source: 'api', providerLabel: PROVIDERS[s.provider]?.name || s.provider });
  all.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  const listEl = els['session-list']; if (!listEl) return;
  if (!all.length) { listEl.innerHTML = '<div class="sidebar-empty">No chats yet</div>'; return; }

  let html = ''; let inToday = false, inYesterday = false, inEarlier = false;
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const yesterdayStart = new Date(todayStart - 86400000);

  for (const s of all) {
    const updated = s.updatedAt || s.createdAt || 0;
    let label = null;
    if (updated >= todayStart.getTime() && !inToday) { label = 'Today'; inToday = true; }
    else if (updated >= yesterdayStart.getTime() && updated < todayStart.getTime() && !inYesterday) { label = 'Yesterday'; inYesterday = true; }
    else if (updated < yesterdayStart.getTime() && !inEarlier) { label = 'Earlier'; inEarlier = true; }
    if (label) html += `<div class="session-group"><div class="session-group-label">${label}</div>`;

    const isActive = s.id === activeSessionId && (s._source === 'pi' ? activeSessionProvider === 'pi' : activeSessionProvider === s.provider);
    const provBadge = s._source === 'api' ? `<span style="font-size:0.6rem;color:var(--muted2);margin-left:0.3rem;">${escapeHtml(s.providerLabel || s.provider)}</span>` : '';
    html += `<div class="session-item ${isActive ? 'active' : ''}" data-id="${escapeHtml(s.id)}" data-source="${s._source}" onclick="window._onSessionClick(event,this)">
      <span class="icon">${isActive ? '💬' : '💭'}</span>
      <span class="title" id="s-title-${escapeHtml(s.id)}">${escapeHtml(s.name || 'Chat')}${provBadge}</span>
      <span class="time">${formatTime(updated)}</span>
      <div class="actions" onclick="event.stopPropagation()">
        <button title="Rename" onclick="window._onSessionRename('${escapeHtml(s.id)}','${s._source}')">✎</button>
        <button title="Delete" onclick="window._onSessionDelete('${escapeHtml(s.id)}','${s._source}')">🗑</button>
      </div>
    </div>`;
  }
  if (inToday || inYesterday || inEarlier) html += '</div>';
  listEl.innerHTML = html;
}

window._onSessionClick = async function(ev, el) {
  ev.preventDefault();
  const id = el.dataset.id; const source = el.dataset.source;
  if (id === activeSessionId && ((source === 'pi' && activeSessionProvider === 'pi') || (source !== 'pi' && activeSessionProvider !== 'pi'))) return;

  if (isStreaming) stopGeneration();

  if (source === 'pi') {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'switch_session', sessionId: id }));
    }
    activeSessionId = id; activeSessionProvider = 'pi';
    const s = sessionsData.find(s => s.id === id);
    if (s) setHeaderTitle(s.name);
    if (els.messages) els.messages.innerHTML = '';
    CFG.currentProvider = 'pi';
  } else {
    // API session
    const session = await getApiSession(id);
    if (!session) return;
    activeSessionId = id; activeSessionProvider = session.provider;
    CFG.currentProvider = session.provider;
    CFG.currentModel = session.model;
    currentModel = session.model;
    setHeaderTitle(session.name);
    if (els.messages) {
      els.messages.innerHTML = '';
      renderApiHistory(session.messages || []);
    }
  }
  await refreshSessionList();
  if (els.sidebar) { els.sidebar.classList.remove('open'); els.sidebarOverlay.style.display = 'none'; }
  if (currentAssistantEl) { if (currentAssistantEl._raf) cancelAnimationFrame(currentAssistantEl._raf); currentAssistantEl = null; }
  isStreaming = false; streamCount = 0;
};

function renderApiHistory(messages) {
  if (!els.messages) return;
  if (!messages.length) { showWelcome(); return; }
  for (const msg of messages) {
    if (msg.role === 'user') {
      let html = escapeHtml(msg.content);
      if (msg.attachments?.length) {
        html += msg.attachments.map(a => {
          if (a.type === 'image') return `<div class="msg-attach"><img src="${escapeHtml(a.data)}"></div>`;
          return `<div class="msg-attach-file">📄 ${escapeHtml(a.name)}</div>`;
        }).join('');
      }
      createMessage('user', html);
    } else if (msg.role === 'assistant') {
      const el = createMessage('assistant', formatMarkdown(msg.content));
      highlightCode(el);
    } else if (msg.role === 'error') {
      createMessage('error', escapeHtml(msg.content));
    }
  }
}

window._onSessionRename = async function(id, source) {
  const titleEl = document.getElementById('s-title-' + id); if (!titleEl) return;
  const oldName = titleEl.childNodes[0]?.textContent || titleEl.textContent || '';
  const item = titleEl.closest('.session-item'); if (!item) return;
  item.innerHTML = `<span class="icon">💬</span><input type="text" class="edit" id="s-edit-${id}" value="${escapeHtml(oldName)}"><span class="time"></span>`;
  const input = document.getElementById('s-edit-' + id);
  input.focus(); input.select();
  const finish = async (name) => {
    try {
      name = (name || '').trim();
      if (!name || name === oldName) { await refreshSessionList(); return; }
      if (source === 'pi') {
        const s = sessionsData.find(s => s.id === id); if (s) s.name = name;
        if (id === activeSessionId) setHeaderTitle(name);
        try {
          await fetch('/chat-session/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) });
        } catch (e) { console.warn('Rename error:', e); }
        await refreshSessionList();
      } else {
        const session = await getApiSession(id); if (!session) { await refreshSessionList(); return; }
        session.name = name; session.updatedAt = Date.now();
        await putApiSession(session);
        if (id === activeSessionId) setHeaderTitle(name);
        await refreshSessionList();
      }
    } catch (err) {
      console.error('Rename failed:', err);
      await refreshSessionList();
    }
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') finish(input.value); if (e.key === 'Escape') { input.blur(); refreshSessionList(); } };
  input.onblur = () => finish(input.value);
};

window._onSessionDelete = async function(id, source) {
  if (!confirm('Delete this chat? This cannot be undone.')) return;
  try {
    if (source === 'pi') {
      await fetch('/chat-session/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      sessionsData = sessionsData.filter(s => s.id !== id);
    } else {
      await deleteApiSession(id);
    }
    if (id === activeSessionId) { activeSessionId = null; activeSessionProvider = null; if (els.messages) els.messages.innerHTML = ''; showWelcome(); setHeaderTitle('New Chat'); }
    await refreshSessionList();
  } catch (err) {
    console.error('Delete failed:', err);
    showToast('Failed to delete session');
  }
};

// ── Settings panel ──────────────────────────────────────
function openSettings() {
  if (els['settings-panel']) els['settings-panel'].classList.add('open');
  if (els['settings-overlay']) els['settings-overlay'].classList.add('open');
  loadSettingsUI();
}
function closeSettings() {
  if (els['settings-panel']) els['settings-panel'].classList.remove('open');
  if (els['settings-overlay']) els['settings-overlay'].classList.remove('open');
}

function loadSettingsUI() {
  // Build provider API key inputs
  const body = els['settings-panel']?.querySelector('.settings-body'); if (!body) return;
  // Keep system prompt textarea and prepend provider settings
  const existing = body.querySelector('.provider-settings');
  if (existing) existing.remove();

  const provDiv = document.createElement('div');
  provDiv.className = 'provider-settings';

  // Provider selector
  let html = '<div class="setting-group"><label>Active Provider</label>';
  html += '<div class="provider-grid">';
  for (const [pid, prov] of Object.entries(PROVIDERS)) {
    const active = CFG.currentProvider === pid ? 'active' : '';
    html += `<button class="provider-card ${active}" data-pid="${pid}" onclick="window._selectProvider('${pid}')">
      <span class="provider-logo" style="background:${prov.color}">${prov.logo}</span>
      <span class="provider-info"><strong>${escapeHtml(prov.name)}</strong><small>${escapeHtml(prov.description)}</small></span>
    </button>`;
  }
  html += '</div></div>';

  // API keys
  const currentProv = PROVIDERS[CFG.currentProvider];
  if (currentProv?.requiresKey) {
    const key = getStoredKey(CFG.currentProvider);
    html += `<div class="setting-group">
      <label>${escapeHtml(currentProv.keyName)} <a href="${currentProv.keyUrl}" target="_blank" rel="noopener" style="font-size:0.7rem;color:var(--accent2);margin-left:0.4rem;">Get key →</a></label>
      <input type="password" id="settings-apikey" value="${escapeHtml(key)}" placeholder="Paste your API key here…" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:0.6rem 0.8rem;color:var(--text);font-family:inherit;outline:none;margin-bottom:0.5rem;">
      <p class="hint" style="margin-top:0.3rem;">Stored in your browser's localStorage. The server never sees it.</p>
    </div>`;
  }

  if (currentProv?.needsBaseUrl) {
    html += `<div class="setting-group">
      <label>Ollama Base URL</label>
      <input type="text" id="settings-ollama-url" value="${escapeHtml(getStoredBaseUrl())}" placeholder="http://localhost:11434" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:0.6rem 0.8rem;color:var(--text);font-family:inherit;outline:none;">
      <p class="hint" style="margin-top:0.3rem;">Must be reachable from this server or your browser.</p>
    </div>`;
  }

  // Generation params
  html += `<div class="setting-group"><label>Parameters</label>
    <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-end;">
      <div style="flex:1;min-width:120px;">
        <label style="text-transform:none;font-size:0.7rem;margin-bottom:0.2rem;">Temperature</label>
        <input type="range" id="settings-temp" min="0" max="2" step="0.1" value="${CFG.temperature}" style="width:100%;">
        <div style="font-size:0.75rem;color:var(--muted);text-align:center;margin-top:0.2rem;" id="temp-val">${CFG.temperature}</div>
      </div>
      <div style="flex:1;min-width:120px;">
        <label style="text-transform:none;font-size:0.7rem;margin-bottom:0.2rem;">Max Tokens</label>
        <input type="number" id="settings-maxtokens" value="${CFG.maxTokens}" min="256" max="32000" step="256" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:0.4rem 0.6rem;color:var(--text);font-family:inherit;outline:none;">
      </div>
    </div>
  </div>
  <div class="setting-group">
    <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;text-transform:none;font-size:0.85rem;">
      <input type="checkbox" id="settings-inject-context" ${CFG.injectContext ? 'checked' : ''} style="accent-color:var(--accent);">
      <span>Inject personal context</span>
    </label>
    <p class="hint" style="margin-top:0.2rem;">Include README, MEMORY, and TASKS from ~/.pi/agent/ in external API sessions.</p>
  </div>`;

  // System prompt (static textarea already exists in HTML)
  const sysIn = document.getElementById('system-prompt-input');
  if (sysIn) sysIn.value = CFG.systemPrompt;

  provDiv.innerHTML = html;
  body.insertBefore(provDiv, body.firstChild);

  // Bind sliders/inputs
  const tempSlider = document.getElementById('settings-temp');
  if (tempSlider) {
    tempSlider.oninput = () => { document.getElementById('temp-val').textContent = tempSlider.value; };
  }
}

window._selectProvider = async function(pid) {
  CFG.currentProvider = pid;
  currentModel = CFG.currentModel;

  if (pid === 'ollama') {
    if (els['model-current']) els['model-current'].querySelector('span:first-child').textContent = 'Fetching models…';
    const models = await fetchOllamaModels(getStoredBaseUrl());
    PROVIDERS.ollama.models = models;
    populateModels([]);
    if (!models.length) {
      showToast('No Ollama models found. Check console (F12) for details. If testing cross-machine, set OLLAMA_ORIGINS=* on the Ollama host.');
    }
  } else if (pid === 'pi') {
    populateModels(availableModels);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'get_available_models', id: 'models-req-' + Date.now() }));
    }
  } else {
    populateModels([]);
  }
  loadSettingsUI();
};

function saveSettings() {
  const currentProv = PROVIDERS[CFG.currentProvider];
  if (currentProv?.requiresKey) {
    const keyIn = document.getElementById('settings-apikey');
    if (keyIn) setStoredKey(CFG.currentProvider, keyIn.value.trim());
  }
  if (currentProv?.needsBaseUrl) {
    const urlIn = document.getElementById('settings-ollama-url');
    if (urlIn) setStoredBaseUrl(urlIn.value.trim());
  }
  const sysIn = document.getElementById('system-prompt-input');
  if (sysIn) CFG.systemPrompt = sysIn.value;
  const tempIn = document.getElementById('settings-temp');
  if (tempIn) CFG.temperature = parseFloat(tempIn.value);
  const maxIn = document.getElementById('settings-maxtokens');
  if (maxIn) CFG.maxTokens = parseInt(maxIn.value, 10) || 4096;
  const injectCtx = document.getElementById('settings-inject-context');
  if (injectCtx) CFG.injectContext = injectCtx.checked;

  // Sync all provider keys to server
  const keysToSave = {};
  for (const pid of Object.keys(PROVIDERS)) {
    if (PROVIDERS[pid].requiresKey) {
      keysToSave[pid] = getStoredKey(pid);
    }
  }
  fetch('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(keysToSave)
  }).catch(() => {});

  showToast('Settings saved');
  closeSettings();
}

function resetSystemPrompt() {
  const sysIn = document.getElementById('system-prompt-input');
  if (sysIn) sysIn.value = '';
}

function showStopButton() {
  if (els.send) els.send.style.display = 'none';
  if (els['stop-btn']) els['stop-btn'].classList.add('visible');
}
function hideStopButton() {
  if (els['stop-btn']) els['stop-btn'].classList.remove('visible');
  if (els.send) els.send.style.display = '';
}

// ── pi Agent (WebSocket) ────────────────────────────────
function connectPiWS() {
  wsReady = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { try { ws.close(); } catch {} ws = null; }
  if (reconnectAttempts >= MAX_RECONNECT) { setStatus('offline', 'Unavailable'); return; }
  reconnectAttempts++;
  setStatus('offline', reconnectAttempts === 1 ? 'Connecting…' : `Reconnecting (${reconnectAttempts})…`);
  try { ws = new WebSocket(WS_URL); } catch(e) { setStatus('offline', 'Failed'); return; }

  ws.onopen = () => {
    reconnectAttempts = 0;
    setStatus('online', 'Ready');
    ws.send(JSON.stringify({ type: 'get_available_models', id: 'models-init' }));
  };
  ws.onmessage = (ev) => { try { handlePiEvent(JSON.parse(ev.data)); } catch(e) { console.warn('Bad JSON:', ev.data); } };
  ws.onclose = () => {
    wsReady = false;
    setStatus('offline', 'Disconnected');
    ws = null;
    if (reconnectAttempts < MAX_RECONNECT) reconnectTimer = setTimeout(connectPiWS, 2500);
    else setStatus('offline', 'Unavailable. Refresh to retry.');
  };
  ws.onerror = () => setStatus('offline', 'Connection error');
}

function handlePiEvent(data) {
  switch (data.type) {
    case 'response':
      if (data.command === 'get_available_models') {
        if (data.success && data.data?.models) {
          availableModels = data.data.models;
          if (!currentModel && availableModels.length) currentModel = availableModels[0].id;
          populateModels(availableModels);
        }
        return;
      }
      if (data.command === 'set_model' && data.success) { showToast('Model switched'); return; }
      if (!data.success && data.error) {
        hideWelcome(); createMessage('error', escapeHtml(data.error));
      }
      break;

    case 'session_list':
      wsReady = true; sessionsData = data.sessions || [];
      refreshSessionList();
      if (!activeSessionId && sessionsData.length) {
        activeSessionId = sessionsData[0].id; activeSessionProvider = 'pi'; setHeaderTitle(sessionsData[0].name);
      }
      break;

    case 'history':
      wsReady = true; renderHistory(data.messages);
      if (data.fresh) showWelcome();
      break;

    case 'message_update': {
      const ev = data.assistantMessageEvent; if (!ev) return;
      if (ev.type === 'text_start') {
        hideWelcome(); currentAssistantEl = createMessage('assistant streaming'); streamCount++; isStreaming = true; setStatus('busy', 'Thinking…');
      } else if (ev.type === 'text_delta') {
        if (!currentAssistantEl) { hideWelcome(); currentAssistantEl = createMessage('assistant streaming'); }
        if (!currentAssistantEl._buf) currentAssistantEl._buf = '';
        currentAssistantEl._buf += ev.delta;
        if (!currentAssistantEl._raf) {
          currentAssistantEl._raf = requestAnimationFrame(() => {
            if (currentAssistantEl) { currentAssistantEl.innerHTML = formatMarkdown(currentAssistantEl._buf); currentAssistantEl._raf = null; }
            scrollToBottom();
          });
        }
      } else if (ev.type === 'text_end') {
        if (currentAssistantEl) { if (currentAssistantEl._raf) cancelAnimationFrame(currentAssistantEl._raf); currentAssistantEl.innerHTML = formatMarkdown(currentAssistantEl._buf || ''); currentAssistantEl.classList.remove('streaming'); highlightCode(currentAssistantEl); currentAssistantEl = null; }
        streamCount = Math.max(0, streamCount - 1); isStreaming = streamCount > 0; if (!isStreaming) setStatus('online', 'Ready'); refreshSessionList();
      } else if (ev.type === 'done' || ev.type === 'error') {
        if (currentAssistantEl) { if (currentAssistantEl._raf) cancelAnimationFrame(currentAssistantEl._raf); currentAssistantEl.innerHTML = formatMarkdown(currentAssistantEl._buf || ''); currentAssistantEl.classList.remove('streaming'); highlightCode(currentAssistantEl); currentAssistantEl = null; }
        streamCount = 0; isStreaming = false; setStatus('online', 'Ready'); refreshSessionList();
      }
      break;
    }

    case 'agent_start': streamCount++; isStreaming = true; setStatus('busy', 'Working…'); break;
    case 'agent_end': streamCount = Math.max(0, streamCount - 1); isStreaming = streamCount > 0; if (!isStreaming) setStatus('online', 'Ready'); break;

    case 'tool_execution_start': {
      hideWelcome(); const el = createMessage('tool');
      el.innerHTML = `<span class="tool-name">⚙ ${escapeHtml(data.toolName)}</span> running…`; el._tid = data.toolCallId; break;
    }
    case 'tool_execution_end': {
      const el = Array.from(els.messages?.children || []).find(e => e._tid === data.toolCallId);
      if (el) { const ok = !data.isError; el.innerHTML = `<span class="tool-name">${ok ? 'OK' : 'ERR'} ${escapeHtml(data.toolName)}</span> ${ok ? 'done' : 'error'}`; }
      break;
    }

    case 'extension_ui_request': handlePiUI(data); break;
    case 'extension_error': hideWelcome(); createMessage('error', `Extension error: ${escapeHtml(data.error || 'unknown')}`); break;
  }
}

function renderHistory(messages) {
  if (!els.messages) return;
  els.messages.innerHTML = '';
  if (!messages || messages.length === 0) { showWelcome(); return; }
  for (const msg of messages) {
    if (msg.role === 'user') {
      createMessage('user', escapeHtml(msg.content));
    } else if (msg.role === 'assistant') {
      const el = createMessage('assistant'); el.innerHTML = formatMarkdown(msg.content); highlightCode(el);
    } else if (msg.role === 'tool') {
      const el = createMessage('tool'); el.innerHTML = `<span class="tool-name">⚙</span> ${escapeHtml(msg.content || '')}`;
    } else if (msg.role === 'error') {
      createMessage('error', escapeHtml(msg.content || ''));
    }
  }
}

// Pi extension UI handlers
function handlePiUI(data) {
  // Keep minimal — pi agent UI handling is a rabbit hole; just ack it
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'extension_ui_response', id: data.id, cancelled: true }));
  }
}

// ── External Provider Engine ────────────────────────────
function msgToApiFormat(m, provider) {
  if (m.role !== 'user' || !m.attachments?.length || provider === 'ollama') {
    return { role: m.role, content: m.content };
  }
  const content = [];
  for (const att of m.attachments) {
    if (att.type === 'image') {
      if (provider === 'claude') {
        const base64 = att.data.split(',')[1];
        const mediaType = att.data.match(/^data:([^;]+);/)?.[1] || 'image/jpeg';
        content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
      } else {
        // openai / xai / kimi / smart
        content.push({ type: 'image_url', image_url: { url: att.data } });
      }
    }
  }
  content.push({ type: 'text', text: m.content });
  return { role: m.role, content };
}

async function sendApiMessage(text) {
  const prov = PROVIDERS[CFG.currentProvider]; if (!prov) return;
  let modelId = currentModel || CFG.currentModel || prov.defaultModel;
  if (modelId === 'custom') {
    modelId = getCustomModel(CFG.currentProvider) || prov.defaultModel;
  }
  // Ollama safety: ensure we have a real model ID
  if (CFG.currentProvider === 'ollama') {
    if (!modelId && PROVIDERS.ollama.models?.length) {
      modelId = PROVIDERS.ollama.models[0].id;
      currentModel = modelId;
      CFG.currentModel = modelId;
    }
    if (!modelId) {
      showToast('No Ollama models available. Run `ollama list` on your desktop to see pulled models.');
      return;
    }
  }
  if (!modelId) {
    showToast('No model selected. Choose one from the model picker.');
    return;
  }
  hideWelcome(); showStopButton();

  // Build messages array from current session
  let session = activeSessionId ? await getApiSession(activeSessionId) : null;
  if (!session) {
    const id = `${CFG.currentProvider}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    session = { id, name: text.slice(0, 40) || 'New Chat', provider: CFG.currentProvider, model: modelId, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    activeSessionId = id; activeSessionProvider = CFG.currentProvider;
    if (text) setHeaderTitle(session.name);
  }
  if (session.messages.length === 0) {
    let sys = [];
    if (CFG.injectContext && agentContextText !== '') {
      // If agentContextText is null (not fetched yet), fetch lazily
      if (agentContextText === null) await fetchAgentContext();
      if (agentContextText) sys.push(agentContextText);
    }
    if (CFG.systemPrompt) sys.push(CFG.systemPrompt);
    if (sys.length) {
      session.messages.push({ role: 'system', content: sys.join('\n\n'), timestamp: Date.now() });
    }
  }

  // Add user message
  const userMsg = { role: 'user', content: text, timestamp: Date.now() };
  if (pendingAttachments.length) userMsg.attachments = [...pendingAttachments];
  session.messages.push(userMsg);
  await putApiSession(session);

  // Render user msg
  let userHtml = escapeHtml(text);
  if (pendingAttachments.length) {
    for (const att of pendingAttachments) {
      if (att.type === 'image') userHtml += `<div class="msg-attach"><img src="${escapeHtml(att.data)}"></div>`;
      else userHtml += `<div class="msg-attach-file">📄 ${escapeHtml(att.name)}</div>`;
    }
  }
  createMessage('user', userHtml);
  pendingAttachments = []; renderAttachments();

  // Stream assistant response
  isStreaming = true; setStatus('busy', 'Thinking…');
  currentAssistantEl = createMessage('assistant streaming');
  let fullText = '';
  abortCtrl = new AbortController();

  // Build API messages (convert attachments to multimodal format for vision providers)
  const apiMessages = session.messages
    .filter(m => m.role !== 'system' && m.role !== 'error')
    .map(m => (CFG.currentProvider === 'ollama') ? { role: m.role, content: m.content } : msgToApiFormat(m, CFG.currentProvider));

  try {
    let stream;
    if (CFG.currentProvider === 'ollama') {
      stream = ollamaChatStream(modelId, apiMessages,
        CFG.systemPrompt, { temperature: CFG.temperature, topP: 1, maxTokens: CFG.maxTokens },
        abortCtrl.signal
      );
    } else {
      stream = proxyChatStream(
        CFG.currentProvider, modelId, apiMessages,
        CFG.systemPrompt, { temperature: CFG.temperature, topP: 1, maxTokens: CFG.maxTokens },
        abortCtrl.signal
      );
    }

    for await (const chunk of stream) {
      if (!isStreaming) break;
      if (chunk.type === 'text') {
        fullText += chunk.text || '';
        if (currentAssistantEl) {
          if (!currentAssistantEl._raf) {
            currentAssistantEl._raf = requestAnimationFrame(() => {
              if (currentAssistantEl) { currentAssistantEl.innerHTML = formatMarkdown(fullText); currentAssistantEl._raf = null; }
              scrollToBottom();
            });
          }
        }
      }
    }
    if (currentAssistantEl) {
      if (currentAssistantEl._raf) cancelAnimationFrame(currentAssistantEl._raf);
      currentAssistantEl.innerHTML = formatMarkdown(fullText);
      currentAssistantEl.classList.remove('streaming'); highlightCode(currentAssistantEl); currentAssistantEl = null;
    }
    session.messages.push({ role: 'assistant', content: fullText, timestamp: Date.now() });
  } catch (err) {
    let errText = err.message || 'Unknown error';
    // If upstream rejected model, name the model in the error
    if (/model.*not found|invalid model|model not supported|does not exist/i.test(errText)) {
      errText += ` (tried model: ${modelId})`;
    }
    if (currentAssistantEl) {
      if (currentAssistantEl._raf) cancelAnimationFrame(currentAssistantEl._raf);
      currentAssistantEl.innerHTML = formatMarkdown(fullText + '\n\n**Error:** ' + errText);
      currentAssistantEl.classList.remove('streaming'); highlightCode(currentAssistantEl); currentAssistantEl = null;
    }
    session.messages.push({ role: 'error', content: errText, timestamp: Date.now() });
  } finally {
    isStreaming = false; abortCtrl = null; setStatus('online', 'Ready'); hideStopButton();
  }

  session.updatedAt = Date.now();
  if (!session.name || session.name === 'New Chat') session.name = text.slice(0, 40) || 'New Chat';
  await putApiSession(session);
  await refreshSessionList();

  // After first exchange, ask AI to generate a better title in the background
  if (session.provider !== 'pi' && session.messages.length >= 2) {
    generateChatTitle(session).then(async title => {
      if (title && title !== (session.name || 'New Chat')) {
        session.name = title;
        setHeaderTitle(title);
        await putApiSession(session);
        await refreshSessionList();
      }
    }).catch(() => {});
  }
}

// ── Send / Stop ─────────────────────────────────────────
function sendUserMessage(text) {
  if (!text) { text = els.input?.value?.trim(); if (!text) return; els.input.value = ''; els.input.rows = 1; }
  if (isStreaming) return; // queue not supported in v1

  if (CFG.currentProvider === 'pi') {
    if (!ws || ws.readyState !== 1) { createMessage('error', 'Not connected to pi. Please wait or refresh.'); return; }
    if (!wsReady) { createMessage('error', 'Still connecting. Please wait.'); return; }
    ws.send(JSON.stringify({ type: 'prompt', message: text }));
    createMessage('user', escapeHtml(text));
    hideWelcome();
  } else {
    sendApiMessage(text);
  }
}

function stopGeneration() {
  if (CFG.currentProvider === 'pi') {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'abort' }));
  } else {
    if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
  }
  streamCount = 0; isStreaming = false; hideStopButton();
  if (currentAssistantEl) {
    if (currentAssistantEl._raf) cancelAnimationFrame(currentAssistantEl._raf);
    currentAssistantEl.classList.remove('streaming'); currentAssistantEl = null;
  }
  setStatus('online', 'Ready');
}

async function saveCurrentChat() {
  if (!els.messages) return;
  const msgs = els.messages.querySelectorAll('.msg');
  if (!msgs.length) { showToast('Nothing to save'); return; }
  let transcript = '';
  let firstUserText = '';
  for (const m of msgs) {
    const role = m.classList.contains('user') ? 'Xanmal'
      : m.classList.contains('assistant') ? 'AI'
      : m.classList.contains('tool') ? 'Tool'
      : 'System';
    const text = m.innerText.trim();
    if (!text) continue;
    if (!firstUserText && role === 'Xanmal') firstUserText = text.slice(0, 60);
    transcript += `\n[${role}]\n${text}\n`;
  }
  const header = `Session: ${activeSessionId || 'current'} | Provider: ${CFG.currentProvider} | Model: ${CFG.currentModel || 'default'}\nDate: ${new Date().toISOString()}\n---`;
  const body = { header, content: transcript.trim(), topic: firstUserText };
  try {
    const r = await fetch('/api/chat-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Server rejected export');
    const data = await r.json();
    showToast('Saved to ' + (data.filename || 'archive'));
  } catch (err) {
    showToast('Save failed: ' + err.message);
  }
}

async function generateChatTitle(session) {
  const prov = PROVIDERS[session.provider];
  if (!prov || session.provider === 'pi') return null;
  try {
    const userMsg = session.messages.find(m => m.role === 'user')?.content?.slice(0, 800) || '';
    const prompt = `Summarize this user message into a very short 3-5 word chat title. Be concise. Only output the title text, nothing else.\n\nUser message:\n"""${userMsg}"""`;
    const r = await fetch('/api/proxy/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: session.provider,
        model: session.model,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 20,
        temperature: 0.4,
        topP: 1,
        stream: false
      })
    });
    if (!r.ok) return null;
    const raw = await r.text();
    const lines = raw.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'text' && obj.text) {
          return obj.text.trim().replace(/^["'“”]+|["'“”]+$/g, '').slice(0, 60) || null;
        }
      } catch {}
    }
    return null;
  } catch { return null; }
}

// ── New Chat ────────────────────────────────────────────
async function startNewChat() {
  if (isStreaming) stopGeneration();
  if (CFG.currentProvider === 'pi') {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'new_session' }));
      if (els.messages) els.messages.innerHTML = '';
      showWelcome();
      activeSessionId = null; activeSessionProvider = 'pi';
    }
  } else {
    activeSessionId = null; activeSessionProvider = null;
    if (els.messages) els.messages.innerHTML = '';
    showWelcome();
    setHeaderTitle('New Chat');
  }
  if (currentAssistantEl) { if (currentAssistantEl._raf) cancelAnimationFrame(currentAssistantEl._raf); currentAssistantEl = null; }
  isStreaming = false; streamCount = 0;
  await refreshSessionList();
}

// ── Voice to Text ──────────────────────────────────────
let voiceRec = null;
let isListening = false;
let voiceMediaRecorder = null;
let voiceChunks = [];
let voiceStream = null;

function setupVoiceToText() {
  if (!els['btn-mic'] || !els.input) return;
  els['btn-mic'].style.display = 'flex';
  els['btn-mic'].onclick = async () => {
    if (isListening) {
      // Stop recording
      if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
        voiceMediaRecorder.stop();
      }
      if (voiceStream) {
        voiceStream.getTracks().forEach(t => t.stop());
        voiceStream = null;
      }
      isListening = false;
      if (els['btn-mic']) els['btn-mic'].classList.remove('listening');
      return;
    }

    // Start recording
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      showToast('Microphone access denied or unavailable');
      return;
    }

    voiceChunks = [];
    let mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = '';
      }
    }
    const options = mimeType ? { mimeType } : {};
    voiceMediaRecorder = new MediaRecorder(voiceStream, options);

    voiceMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) voiceChunks.push(e.data);
    };

    voiceMediaRecorder.onstop = async () => {
      isListening = false;
      if (els['btn-mic']) els['btn-mic'].classList.remove('listening');
      if (voiceStream) {
        voiceStream.getTracks().forEach(t => t.stop());
        voiceStream = null;
      }

      if (!voiceChunks.length) return;
      const blob = new Blob(voiceChunks, { type: voiceMediaRecorder.mimeType || 'audio/webm' });
      const form = new FormData();
      form.append('file', blob, 'voice.webm');

      try {
        showToast('Transcribing…');
        const r = await fetch('/api/transcribe', { method: 'POST', body: form });
        if (!r.ok) throw new Error('Transcription failed');
        const data = await r.json();
        const text = (data.text || '').trim();
        if (text && els.input) {
          const prefix = els.input.value ? els.input.value + ' ' : '';
          els.input.value = prefix + text;
          els.input.dispatchEvent(new Event('input', { bubbles: true }));
          els.input.focus();
        } else {
          showToast('No speech detected');
        }
      } catch (err) {
        showToast('Transcription error: ' + (err.message || 'unknown'));
      }
    };

    voiceMediaRecorder.onerror = () => {
      isListening = false;
      if (els['btn-mic']) els['btn-mic'].classList.remove('listening');
      showToast('Recording error');
    };

    voiceMediaRecorder.start();
    isListening = true;
    if (els['btn-mic']) els['btn-mic'].classList.add('listening');
  };
}

// ── Init ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  cacheEls();

  // Bind buttons
  if (els['btn-new-chat']) els['btn-new-chat'].onclick = startNewChat;
  if (els['btn-settings']) els['btn-settings'].onclick = openSettings;
  if (els['btn-clear']) {
    els['btn-clear'].onclick = () => {
      if (!els.messages) return;
      els.messages.innerHTML = '';
      if (isStreaming) stopGeneration();
      showWelcome();
    };
  }
  if (els['btn-save-chat']) els['btn-save-chat'].onclick = saveCurrentChat;
  if (els['btn-close-settings']) els['btn-close-settings'].onclick = closeSettings;
  if (els['settings-overlay']) els['settings-overlay'].onclick = closeSettings;
  if (els['btn-save-prompt']) els['btn-save-prompt'].onclick = saveSettings;
  if (els['btn-reset-prompt']) els['btn-reset-prompt'].onclick = resetSystemPrompt;

  // Send / Stop
  if (els.send) {
    els.send.onclick = () => {
      if (isStreaming) stopGeneration();
      else sendUserMessage();
    };
  }
  if (els['stop-btn']) {
    els['stop-btn'].onclick = stopGeneration;
  }
  if (els.input) {
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (isStreaming) stopGeneration(); else sendUserMessage(); }
    });
    els.input.addEventListener('input', () => { els.input.rows = Math.min(6, Math.max(1, els.input.value.split('\n').length)); });
  }

  // Drag & drop
  if (els.messages) {
    els.messages.addEventListener('dragover', (e) => { e.preventDefault(); els.messages.classList.add('drag-active'); });
    els.messages.addEventListener('dragleave', () => els.messages.classList.remove('drag-active'));
    els.messages.addEventListener('drop', (e) => {
      e.preventDefault(); els.messages.classList.remove('drag-active');
      if (e.dataTransfer.files.length) for (const f of e.dataTransfer.files) processFile(f);
    });
  }

  // File attach button
  if (els['btn-attach']) els['btn-attach'].onclick = () => els['file-input']?.click();
  if (els['file-input']) {
    els['file-input'].onchange = () => {
      const files = Array.from(els['file-input'].files || []);
      if (!files.length) return;
      for (const file of files) processFile(file);
      els['file-input'].value = '';
    };
  }

  // Fetch saved API keys from server on load
  fetch('/api/keys')
    .then(r => { if (!r.ok) throw new Error('Not authenticated'); return r.json(); })
    .then(keys => {
      for (const [provider, key] of Object.entries(keys)) {
        if (key) setStoredKey(provider, key);
      }
    })
    .catch(() => {});

  // Init pi WS
  connectPiWS();

  // Init voice-to-text
  setupVoiceToText();

  // Init health widget
  updateHealthWidget();
  setInterval(updateHealthWidget, 60000);

  // Load session templates
  loadTemplates();
  const templateSel = document.getElementById('template-select');
  if (templateSel) {
    templateSel.onchange = () => {
      const name = templateSel.value;
      if (!name || !cachedTemplates) return;
      const tpl = cachedTemplates.find(t => t.name === name);
      if (!tpl) return;
      const sysIn = document.getElementById('system-prompt-input');
      if (sysIn) {
        sysIn.value = tpl.content;
        CFG.systemPrompt = tpl.content;
      }
    };
  }

  // Load Ollama models if that's the current provider
  if (CFG.currentProvider === 'ollama') {
    fetchOllamaModels(getStoredBaseUrl()).then(models => {
      PROVIDERS.ollama.models = models;
      populateModels([]);
    });
  } else {
    populateModels([]);
  }

  // Validate stored model against current provider list
  validateStoredModel();

  refreshSessionList();
});

})();

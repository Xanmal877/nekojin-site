/* Admin panel: core */
/* Admin panel state, rendering, and event handlers. */
// ── STATE ─────────────────────────────────────────────────
let siteContent = null;
let dirty = false;

// ── INIT ──────────────────────────────────────────────────
async function init() {
  try {
    const ok = await loadContent();
    if (!ok) {
      showContentLoadError();
      return;
    }
    renderBooksPanel();
    renderGamesPanel();
    renderAboutPanel();
    renderVisibilityPanel();
    renderCharacters();
    renderLoreTopics();
    renderTimeline();
    await loadIntegrationsSettings();
  } catch(e) {
    showToast('Init failed: ' + e.message, 'error');
    console.error(e);
  }
}

// The database stores books flat with a `series_id` foreign key (see
// database.js SelectBooks/GetAllContent), series rows never carry a
// `.books` array. The rest of this file predates that schema and still
// treats each series as owning a nested `books` array (getBook/getBooks/
// renderBooksPanel all index through `series[si].books`). nestBooksIntoSeries
// and flattenSeriesBooks are the single boundary that translates between
// the two shapes, so the flat-vs-nested mismatch stays contained here
// instead of needing every render/edit function rewritten.
function nestBooksIntoSeries(loaded) {
  const allBooks = Array.isArray(loaded.books) ? loaded.books : [];
  const series = Array.isArray(loaded.series) ? loaded.series : [];
  for (const s of series) {
    s.books = allBooks
      .filter(b => (b.series_id || b.seriesId) === s.id)
      .sort((a, b) => (a.volume_number || 0) - (b.volume_number || 0));
  }
  loaded.series = series;
  loaded.books = allBooks.filter(b => !(b.series_id || b.seriesId));
  return loaded;
}

function flattenSeriesBooks(content) {
  const standalone = content.books || [];
  const fromSeries = (content.series || []).flatMap(s =>
    (s.books || []).map((b, i) => ({
      ...b,
      seriesId: s.id,
      // Order within a series is purely the array position the admin UI
      // maintains (there's no direct volume-number editor), so persist that
      // position so the public site's ORDER BY volume_number reflects it.
      volumeNumber: i + 1,
    }))
  );
  return { ...content, books: [...standalone, ...fromSeries] };
}

async function loadContent() {
  try {
    const res = await fetch('/content');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const loaded = nestBooksIntoSeries(await res.json());
    siteContent = loaded;
    return true;
  } catch(e) {
    showToast('Failed to load content: ' + e.message, 'error');
    console.error('loadContent failed:', e);
    siteContent = null;
    return false;
  }
}

function showContentLoadError() {
  const overlay = document.createElement('div');
  overlay.id = 'load-failure-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(13,8,32,0.96);' +
    'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1rem;' +
    'color:#fff;text-align:center;padding:2rem;font-family:inherit;';
  overlay.innerHTML = `
    <div style="font-size:3rem;">⚠️</div>
    <h2 style="margin:0;">Failed to load site content</h2>
    <p style="max-width:420px;color:#c8bce0;">The admin panel couldn't load your books, series, game, and about data from the server. To avoid accidentally saving over existing content, editing has been disabled.</p>
    <button class="btn btn-primary" onclick="location.reload()">Reload Page</button>
  `;
  document.body.appendChild(overlay);
}

// ── KEYBOARD SHORTCUTS ────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (dirty) saveContent();
  }
  if (e.key === 'Escape') {
    modalCancel();
    seriesPickerCancel();
  }
});

window.addEventListener('beforeunload', e => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ── PANEL SWITCH ──────────────────────────────────────────
function switchPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  document.querySelector(`[data-panel="${name}"]`).classList.add('active');

  if (name === 'xanrean') loadXanreanSettings();
}

// ── DIRTY TRACKING ────────────────────────────────────────
function markDirty() {
  dirty = true;
  document.getElementById('save-banner').classList.add('visible');
}

async function discardChanges() {
  const ok = await confirmModal('Discard changes?', 'All unsaved edits will be lost.');
  if (!ok) return;
  dirty = false;
  document.getElementById('save-banner').classList.remove('visible');
  const contentLoaded = await loadContent();
  if (!contentLoaded) return;
  renderBooksPanel();
  renderGamesPanel();
  renderAboutPanel();
  renderVisibilityPanel();
  showToast('Changes discarded.');
}

// ── INTEGRATIONS SETTINGS ──────────────────────────────────
async function loadIntegrationsSettings() {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    document.getElementById('settings-gumroad-seller-id').value = data.gumroad_seller_id || '';
    document.getElementById('settings-gumroad-token').value = data.gumroad_access_token || '';
    document.getElementById('settings-youtube-channel').value = data.youtube_channel_id || '';
    document.getElementById('settings-discord-server').value = data.discord_server_id || '';
    document.getElementById('settings-discord-invite').value = data.discord_invite_code || '';
  } catch(e) {
    console.error('loadIntegrationsSettings failed:', e);
    // We don't show a toast here to avoid cluttering init, but could be added if requested
  }
}

async function saveIntegrationsSettings() {
  const data = {
    gumroad_seller_id: document.getElementById('settings-gumroad-seller-id').value.trim(),
    gumroad_access_token: document.getElementById('settings-gumroad-token').value.trim(),
    youtube_channel_id: document.getElementById('settings-youtube-channel').value.trim(),
    discord_server_id: document.getElementById('settings-discord-server').value.trim(),
    discord_invite_code: document.getElementById('settings-discord-invite').value.trim()
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      showToast('✓ Integrations saved!');
    } else {
      let msg = 'Save failed';
      try { const errBody = await res.json(); if (errBody.error) msg = errBody.error; } catch {}
      showToast(msg, 'error');
    }
  } catch(e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

// ── BACKGROUND SETTINGS (localStorage only) ──────────────
function loadBgSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('admin-bg') || '{}');
    if (s.url) {
      document.body.style.backgroundImage = `url(${esc(s.url)})`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
      const opacity = s.opacity != null ? s.opacity : 15;
      document.body.style.backgroundBlendMode = 'overlay';
      // Apply a dark overlay via pseudo-element would need CSS, but we can use a gradient
      // For simplicity, just set the image and opacity on a wrapper isn't available.
      // Instead, we'll inject a style tag for the body::before overlay
      injectBgOverlay(opacity / 100);
    }
    if (s.url) document.getElementById('bg-url-input').value = s.url;
    if (s.opacity != null) {
      document.getElementById('bg-opacity').value = s.opacity;
      document.getElementById('opacity-val').textContent = s.opacity;
    }
    updateBgPreview(s.url);
  } catch(e) {}
}

function updateBgPreview(url) {
  const wrap = document.getElementById('bg-preview-wrap');
  if (!wrap) return;
  if (url) {
    wrap.innerHTML = `<img class="bg-preview" src="${ esc(url) }" alt="Background preview">`;
  } else {
    wrap.innerHTML = `<div class="bg-preview-empty">No background image set</div>`;
  }
}

function applyBgPreview(url) {
  updateBgPreview(url);
}

function applyBgOpacity(val) {
  injectBgOverlay(val / 100);
}

function injectBgOverlay(opacity) {
  let el = document.getElementById('admin-bg-overlay');
  if (!el) {
    el = document.createElement('style');
    el.id = 'admin-bg-overlay';
    document.head.appendChild(el);
  }
  el.textContent = `body::before{content:"";position:fixed;inset:0;background:rgba(10,6,20,${Math.max(0,Math.min(1,1-opacity))});z-index:-1;pointer-events:none;}`;
}

function saveBgSettings() {
  const url = document.getElementById('bg-url-input').value.trim();
  const opacity = parseInt(document.getElementById('bg-opacity').value, 10);
  localStorage.setItem('admin-bg', JSON.stringify({ url, opacity }));
  loadBgSettings();
  showToast('Background applied');
}

function clearBgSettings() {
  localStorage.removeItem('admin-bg');
  document.body.style.backgroundImage = '';
  document.body.style.backgroundSize = '';
  document.body.style.backgroundPosition = '';
  document.body.style.backgroundAttachment = '';
  const el = document.getElementById('admin-bg-overlay');
  if (el) el.textContent = '';
  updateBgPreview('');
  showToast('Background removed');
}

// ── TOAST ─────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── MODAL SYSTEM ──────────────────────────────────────────
let _modalResolve = null;
let _modalMode    = 'confirm'; // 'confirm' | 'prompt'

function confirmModal(title, body) {
  return new Promise(resolve => {
    _modalResolve = resolve;
    _modalMode = 'confirm';
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').textContent  = body;
    const inp = document.getElementById('modal-input');
    inp.style.display = 'none';
    document.getElementById('modal-confirm-btn').textContent = 'Confirm';
    document.getElementById('modal-confirm-btn').className = 'btn btn-danger btn-sm';
    document.getElementById('modal').classList.add('show');
  });
}

function promptModal(title, placeholder = '', defaultVal = '', confirmLabel = 'Create') {
  return new Promise(resolve => {
    _modalResolve = resolve;
    _modalMode = 'prompt';
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').textContent  = '';
    const inp = document.getElementById('modal-input');
    inp.style.display = 'block';
    inp.placeholder = placeholder;
    inp.value = defaultVal;
    document.getElementById('modal-confirm-btn').textContent = confirmLabel;
    document.getElementById('modal-confirm-btn').className = 'btn btn-primary btn-sm';
    document.getElementById('modal').classList.add('show');
    setTimeout(() => inp.focus(), 50);
  });
}

function modalConfirm() {
  const val = _modalMode === 'prompt'
    ? (document.getElementById('modal-input').value.trim() || null)
    : true;
  _closeModal(val);
}

function modalCancel() {
  _closeModal(_modalMode === 'prompt' ? null : false);
}

function _closeModal(val) {
  document.getElementById('modal').classList.remove('show');
  if (_modalResolve) { _modalResolve(val); _modalResolve = null; }
}

function modalBackdropClick(e) {
  if (e.target.id === 'modal') modalCancel();
}

// ── SERIES PICKER MODAL ───────────────────────────────────
let _seriesPickerResolve = null;

function openSeriesPickerModal() {
  return new Promise(resolve => {
    _seriesPickerResolve = resolve;
    const list = document.getElementById('series-pick-list');
    let html = '';
    (siteContent.series || []).forEach((s, si) => {
      html += `<button class="series-pick-btn" onclick="seriesPickerSelect(${si})">${esc(s.universe)}</button>`;
    });
    html += `<button class="series-pick-btn standalone" onclick="seriesPickerSelect(-1)">📎 Standalone (no series)</button>`;
    list.innerHTML = html;
    document.getElementById('series-picker').classList.add('show');
  });
}

function seriesPickerSelect(idx) {
  document.getElementById('series-picker').classList.remove('show');
  if (_seriesPickerResolve) { _seriesPickerResolve(idx); _seriesPickerResolve = null; }
}

function seriesPickerCancel() {
  document.getElementById('series-picker').classList.remove('show');
  if (_seriesPickerResolve) { _seriesPickerResolve(null); _seriesPickerResolve = null; }
}

function seriesPickerBackdropClick(e) {
  if (e.target.id === 'series-picker') seriesPickerCancel();
}

// ── HELPERS ───────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// Convert a UTC ISO string into the YYYY-MM-DDTHH:MM format required by
// <input type="datetime-local"> (local time).
function toDatetimeLocal(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// CSRF token is set as a readable (non-HttpOnly) cookie on login; state-changing
// requests must echo it back in a header so the server can verify same-origin intent.
function getCsrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)nki_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function newBook() {
  const id = `book-${Date.now()}`;
  return { id, slug: '', visible: true, title: 'New Book', volume: '', cover: '', blurb: '', description: '', tags: [], platforms: [] };
}

function getBook(si, bi) {
  return si === -1 ? siteContent.books[bi] : siteContent.series[si].books[bi];
}

function setBook(si, bi, val) {
  if (si === -1) siteContent.books[bi] = val;
  else siteContent.series[si].books[bi] = val;
}

function getBooks(si) {
  return si === -1 ? siteContent.books : siteContent.series[si].books;
}


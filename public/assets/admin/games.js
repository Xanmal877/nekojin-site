/* Admin panel: games */
// ── RENDER: GAME ──────────────────────────────────────────
// ── MULTI-GAME MANAGEMENT ─────────────────────────────────

let currentEditingGameIndex = -1;

function ensureGamesArray() {
  // Never fabricate siteContent here: if content failed to load, siteContent
  // is null on purpose (see loadContent/showContentLoadError) so that saving
  // stays a no-op instead of silently overwriting real data with an empty
  // payload. Bail out rather than inventing a fake empty state.
  if (!siteContent) { showToast('Content failed to load. Reload the page before editing.', 'error'); return; }
  if (!siteContent.game) siteContent.game = [];
  if (!Array.isArray(siteContent.game)) {
    // Convert single game object to array
    const game = siteContent.game;
    siteContent.game = [{
      ...game,
      id: game.id || game.slug || 'main',
      slug: game.slug || 'main'
    }];
  }
}

function renderGamesPanel() {
  ensureGamesArray();
  const games = siteContent.game;

  if (games.length === 0) {
    document.getElementById('games-list').innerHTML = `
      <div style="text-align:center;padding:3rem;color:var(--muted);">
        <div style="font-size:3rem;margin-bottom:1rem;">🎮</div>
        <p>No games yet. Click "Add New Game" to get started!</p>
      </div>
    `;
  } else {
    document.getElementById('games-list').innerHTML = `
      <div class="games-grid">
        ${games.map((g, i) => `
          <div class="game-list-item${g.visible === false ? ' hidden-item' : ''}" id="game-item-${i}" draggable="true"
            ondragstart="gameDragStart(event,${i})" ondragover="gameDragOver(event)"
            ondragenter="gameDragEnter(event)" ondragleave="gameDragLeave(event)" ondrop="gameDragDrop(event,${i})"
            onclick="editGame(${i})" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();editGame(${i})}">
            <span class="drag-handle" title="Drag to reorder" onclick="event.stopPropagation()">⋮⋮</span>
            <img class="game-list-thumb" src="${esc(g.coverImage || '')}" alt="${esc(g.title || 'Game')} cover"
              onerror="this.style.display='none'">
            <div class="game-list-info">
              <div class="game-list-title">${esc(g.title || 'Untitled Game')}</div>
              <div class="game-list-status">${esc(g.status || 'In Development')} • ${g.visible === false ? 'Hidden' : 'Visible'}</div>
            </div>
            <div class="game-list-actions" onclick="event.stopPropagation()">
              <button class="btn btn-ghost btn-sm" onclick="toggleGameVisibility(${i})" title="${g.visible === false ? 'Show' : 'Hide'}">${g.visible === false ? '🙈' : '👁️'}</button>
              <button class="btn btn-ghost btn-sm" onclick="editGame(${i})" title="Edit">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="deleteGame(${i})" title="Delete">🗑️</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
}

function editGame(index) {
  currentEditingGameIndex = index;
  document.getElementById('games-list-container').style.display = 'none';
  document.getElementById('game-edit-container').style.display = 'block';
  renderGameEditor();
}

function backToGamesList() {
  currentEditingGameIndex = -1;
  document.getElementById('games-list-container').style.display = 'block';
  document.getElementById('game-edit-container').style.display = 'none';
  renderGamesPanel();
}

function renderGameEditor() {
  ensureGamesArray();
  const g = siteContent.game[currentEditingGameIndex];
  if (!g) return backToGamesList();

  document.getElementById('game-editor').innerHTML = `
    <div class="card-title">🎮 ${esc(g.title || 'Edit Game')}</div>
    <input type="hidden" id="game-index" value="${currentEditingGameIndex}">

    <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
      <input type="checkbox" ${g.visible === false ? '' : 'checked'} onchange="updateGameField('visible', this.checked)">
      Visible on public games page
    </label>

    <label>Game ID / Slug</label>
    <input type="text" id="game-slug" value="${esc(g.slug || g.id || '')}"
      oninput="updateGameField('slug', this.value)" placeholder="autumns-dungeoneering">

    <label>Game Cover Image</label>
    <div style="display:flex;gap:1.5rem;align-items:flex-start;margin-bottom:1rem;">
      <div class="cover-upload-area" style="width:160px;flex-shrink:0;" onclick="triggerGameCoverUpload()">
        ${g.coverImage
          ? `<img id="game-cover-preview" class="cover-preview" src="${esc(g.coverImage)}" alt="Game cover" style="width:140px;height:auto;">`
          : `<div id="game-cover-preview" style="font-size:2.5rem;margin-bottom:0.5rem;">🎮</div>`
        }
        <div class="upload-hint">Click to upload</div>
        <input type="file" accept="image/*" id="game-cover-input" onchange="handleGameCoverUpload(event)">
      </div>
      <div style="flex:1;">
        <label>Cover Image URL</label>
        <input type="text" id="game-cover-url" value="${esc(g.coverImage||'')}" placeholder="/covers/game-cover.jpg"
          oninput="updateGameField('coverImage', this.value); document.getElementById('game-cover-preview').src=this.value;">
      </div>
    </div>

    <div class="form-row">
      <div><label>Game Title *</label><input type="text" id="game-title" value="${esc(g.title||'')}"
        oninput="updateGameField('title', this.value)" required></div>
      <div><label>Status</label>
        <select id="game-status" onchange="updateGameField('status', this.value)">
          <option value="In Development" ${g.status === 'In Development' ? 'selected' : ''}>In Development</option>
          <option value="Early Access" ${g.status === 'Early Access' ? 'selected' : ''}>Early Access</option>
          <option value="Released" ${g.status === 'Released' ? 'selected' : ''}>Released</option>
          <option value="Coming Soon" ${g.status === 'Coming Soon' ? 'selected' : ''}>Coming Soon</option>
        </select>
      </div>
    </div>

    <label>Tagline</label>
    <input type="text" id="game-tagline" value="${esc(g.tagline||'')}"
      oninput="updateGameField('tagline', this.value)" placeholder="Short subtitle">

    <label>Description</label>
    <textarea id="game-description" rows="4" oninput="updateGameField('description', this.value)"
      placeholder="Full description...">${esc(g.description||'')}</textarea>

    <div class="form-row">
      <div><label>Engine</label><input type="text" value="${esc(g.engine||'')}"
        oninput="updateGameField('engine', this.value)" placeholder="Godot 4"></div>
      <div><label>Players</label><input type="text" value="${esc(g.players||'')}"
        oninput="updateGameField('players', this.value)" placeholder="1"></div>
    </div>

    <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">🎮 Platform Links</div>
      <p style="font-size:0.78rem;color:var(--muted);margin-bottom:1rem;">Add links to stores and platforms.</p>
      <div class="platform-inputs">
        <div class="platform-row">
          <label>Steam</label>
          <input type="url" value="${esc(g.platforms?.steam || g.steamUrl || '')}"
            oninput="updatePlatform('steam', this.value)" placeholder="https://store.steampowered.com/...">
        </div>
        <div class="platform-row">
          <label>Itch.io</label>
          <input type="url" value="${esc(g.platforms?.itch || g.itchUrl || '')}"
            oninput="updatePlatform('itch', this.value)" placeholder="https://...itch.io/...">
        </div>
        <div class="platform-row">
          <label>GOG</label>
          <input type="url" value="${esc(g.platforms?.gog || g.gogUrl || '')}"
            oninput="updatePlatform('gog', this.value)" placeholder="https://www.gog.com/game/...">
        </div>
        <div class="platform-row">
          <label>Epic</label>
          <input type="url" value="${esc(g.platforms?.epic || g.epicUrl || '')}"
            oninput="updatePlatform('epic', this.value)" placeholder="https://store.epicgames.com/...">
        </div>
      </div>
    </div>

    <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">🎲 Demo</div>
      <p style="font-size:0.78rem;color:var(--muted);margin-bottom:1rem;">Add a playable demo. Can be on a store (Steam/Itch) or self-hosted.</p>
      <div class="form-row">
        <div style="flex:0 0 120px;">
          <label style="font-size:0.75rem;">Has Demo</label>
          <select onchange="updateGameField('hasDemo', this.value === 'true'); toggleDemoFields(this.value === 'true')">
            <option value="false" ${!g.hasDemo ? 'selected' : ''}>No</option>
            <option value="true" ${g.hasDemo ? 'selected' : ''}>Yes</option>
          </select>
        </div>
        <div id="demo-platform-row" style="flex:0 0 150px;${!g.hasDemo ? 'display:none;' : ''}">
          <label style="font-size:0.75rem;">Demo On</label>
          <select id="demo-platform-select" onchange="updateGameField('demoPlatform', this.value)">
            <option value="steam" ${g.demoPlatform === 'steam' ? 'selected' : ''}>Steam</option>
            <option value="itch" ${g.demoPlatform === 'itch' ? 'selected' : ''}>Itch.io</option>
            <option value="self" ${g.demoPlatform === 'self' ? 'selected' : ''}>Self-hosted</option>
          </select>
        </div>
        <div id="demo-url-row" style="flex:1;${!g.hasDemo ? 'display:none;' : ''}">
          <label style="font-size:0.75rem;">Demo URL</label>
          <input type="url" id="demo-url-input" value="${esc(g.demoUrl || '')}"
            oninput="updateGameField('demoUrl', this.value)"
            placeholder="https://.../demo or /demo/index.html">
        </div>
      </div>
      <p id="demo-help-text" style="font-size:0.72rem;color:var(--muted);margin-top:0.5rem;${!g.hasDemo ? 'display:none;' : ''}">
        ${g.demoPlatform === 'steam' ? 'Link to Steam demo page' :
          g.demoPlatform === 'itch' ? 'Link to Itch.io demo or project' :
          'Direct link to playable demo (HTML5/WebGL build)'}
      </p>
    </div>

    <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">✨ Features</div>
      <div id="game-features-editor">${renderGameFeatureRows(g.features || [])}</div>
      <button class="btn btn-ghost btn-sm" onclick="addGameFeature()">+ Add Feature</button>
    </div>

    <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">📸 Screenshots</div>
      <div id="game-screenshots-editor">${renderScreenshotRows(g.screenshots || [])}</div>
      <button class="btn btn-ghost btn-sm" onclick="addScreenshot()">+ Add Screenshot</button>
    </div>

    <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">📝 Devlog Entries</div>
      <div id="game-devlog-editor">${renderDevlogRows(g.devlog || [])}</div>
      <button class="btn btn-ghost btn-sm" onclick="addDevlogEntry()">+ Add Devlog Entry</button>
    </div>

    <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">📊 Development Progress</div>
      <p style="font-size:0.78rem;color:var(--muted);margin-bottom:1rem;">Overall completion percentage shown on the public games page.</p>
      <div class="form-row">
        <div style="flex:0 0 160px;">
          <label>Progress (%)</label>
          <input type="number" id="game-progress" min="0" max="100" value="${Number(g.progress || 0)}"
            oninput="updateGameField('progress', Math.max(0, Math.min(100, Number(this.value) || 0)))">
        </div>
        <div style="flex:1;">
          <label>Gameplay Video URL</label>
          <input type="url" id="game-video-url" value="${esc(g.videoUrl || '')}"
            oninput="updateGameField('videoUrl', this.value)" placeholder="https://www.youtube.com/embed/... or https://player.vimeo.com/...">
        </div>
      </div>
    </div>

    <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">🖥️ System Requirements</div>
      <p style="font-size:0.78rem;color:var(--muted);margin-bottom:1rem;">Shown in the Overview tab on the public games page.</p>
      <div class="form-row">
        <div><label>OS</label><input type="text" value="${esc(g.systemRequirements?.os || '')}" placeholder="Windows 10 / Linux" oninput="updateSystemRequirement('os', this.value)"></div>
        <div><label>Processor</label><input type="text" value="${esc(g.systemRequirements?.processor || '')}" placeholder="Quad-core 2.5 GHz" oninput="updateSystemRequirement('processor', this.value)"></div>
      </div>
      <div class="form-row">
        <div><label>Memory</label><input type="text" value="${esc(g.systemRequirements?.memory || '')}" placeholder="8 GB RAM" oninput="updateSystemRequirement('memory', this.value)"></div>
        <div><label>Graphics</label><input type="text" value="${esc(g.systemRequirements?.graphics || '')}" placeholder="Dedicated GPU with 2 GB VRAM" oninput="updateSystemRequirement('graphics', this.value)"></div>
      </div>
      <div class="form-row">
        <div><label>Storage</label><input type="text" value="${esc(g.systemRequirements?.storage || '')}" placeholder="2 GB available space" oninput="updateSystemRequirement('storage', this.value)"></div>
        <div><label>DirectX / Engine Notes</label><input type="text" value="${esc(g.systemRequirements?.directx || '')}" placeholder="Godot 4 / Vulkan-compatible drivers" oninput="updateSystemRequirement('directx', this.value)"></div>
      </div>
    </div>
  `;
}

function updateGameField(field, value) {
  ensureGamesArray();
  if (currentEditingGameIndex >= 0) {
    siteContent.game[currentEditingGameIndex][field] = value;
    markDirty();
  }
}

function toggleDemoFields(show) {
  const platformRow = document.getElementById('demo-platform-row');
  const urlRow = document.getElementById('demo-url-row');
  const helpText = document.getElementById('demo-help-text');

  if (platformRow) platformRow.style.display = show ? 'block' : 'none';
  if (urlRow) urlRow.style.display = show ? 'block' : 'none';
  if (helpText) helpText.style.display = show ? 'block' : 'none';

  // Update help text based on platform
  if (show) {
    const platform = document.getElementById('demo-platform-select')?.value || 'steam';
    const messages = {
      steam: 'Link to Steam demo page',
      itch: 'Link to Itch.io demo or project',
      self: 'Direct link to playable demo (HTML5/WebGL build)'
    };
    if (helpText) helpText.textContent = messages[platform] || messages.self;
  }
}

function updatePlatform(platform, value) {
  ensureGamesArray();
  const game = siteContent.game[currentEditingGameIndex];
  if (!game.platforms) game.platforms = {};
  if (value) {
    game.platforms[platform] = value;
  } else {
    delete game.platforms[platform];
  }
  markDirty();
}

function updateSystemRequirement(field, value) {
  ensureGamesArray();
  const game = siteContent.game[currentEditingGameIndex];
  if (!game.systemRequirements) game.systemRequirements = {};
  if (value) {
    game.systemRequirements[field] = value;
  } else {
    delete game.systemRequirements[field];
  }
  markDirty();
}

function showAddGameModal() {
  document.getElementById('add-game-modal').style.display = 'flex';
  document.getElementById('new-game-title').focus();
}

function closeAddGameModal() {
  document.getElementById('add-game-modal').style.display = 'none';
  document.getElementById('new-game-title').value = '';
  document.getElementById('new-game-slug').value = '';
}

function createNewGame() {
  const title = document.getElementById('new-game-title').value.trim();
  let slug = document.getElementById('new-game-slug').value.trim();

  if (!title) {
    showToast('Please enter a game title', 'error');
    return;
  }

  if (!slug) {
    slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  ensureGamesArray();

  // Check for duplicate slug
  if (siteContent.game.some(g => g.slug === slug)) {
    showToast('A game with this slug already exists', 'error');
    return;
  }

  const newGame = {
    id: slug,
    slug: slug,
    title: title,
    status: 'In Development',
    tagline: '',
    description: '',
    engine: 'Godot 4',
    players: '1',
    platforms: {},
    hasDemo: false,
    demoPlatform: 'itch',
    demoUrl: '',
    features: [],
    screenshots: [],
    devlog: []
  };

  siteContent.game.push(newGame);
  markDirty();
  closeAddGameModal();
  renderGamesPanel();
  showToast('New game created!');
}

function deleteGame(index) {
  if (!confirm('Are you sure you want to delete this game? This cannot be undone.')) return;

  ensureGamesArray();
  siteContent.game.splice(index, 1);
  markDirty();
  renderGamesPanel();
  showToast('Game deleted');
}

function toggleGameVisibility(index) {
  ensureGamesArray();
  const g = siteContent.game[index];
  if (!g) return;
  g.visible = g.visible === false ? true : false;
  markDirty();
  renderGamesPanel();
}

// ── GAMES DRAG AND DROP ─────────────────────────────────────
let _gameDragIndex = null;

function gameDragStart(e, index) {
  _gameDragIndex = index;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => document.getElementById(`game-item-${index}`)?.classList.add('dragging'), 0);
}

function gameDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }

function gameDragEnter(e) {
  e.preventDefault();
  const el = e.currentTarget;
  if (el.classList.contains('game-list-item')) el.classList.add('drag-over');
}

function gameDragLeave(e) {
  const el = e.currentTarget;
  if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
}

async function saveGameOrder(gameIds) {
  try {
    const res = await fetch('/api/games/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ gameIds })
    });
    if (!res.ok) throw new Error('Failed to save order');
    showToast('Order saved');
  } catch (e) {
    showToast('Order save failed: ' + e.message, 'error');
  }
}

function gameDragDrop(e, targetIndex) {
  e.preventDefault();
  document.querySelectorAll('.game-list-item').forEach(el => {
    el.classList.remove('drag-over', 'dragging');
  });
  if (_gameDragIndex === null || _gameDragIndex === targetIndex) return;

  ensureGamesArray();
  const arr = siteContent.game;
  const [moved] = arr.splice(_gameDragIndex, 1);
  arr.splice(targetIndex, 0, moved);
  _gameDragIndex = null;
  markDirty();
  renderGamesPanel();
  saveGameOrder(arr.map(g => g.id));
}

function deleteCurrentGame() {
  if (currentEditingGameIndex >= 0) {
    deleteGame(currentEditingGameIndex);
    backToGamesList();
  }
}

function saveCurrentGame() {
  // Validation
  const title = document.getElementById('game-title')?.value.trim();
  if (!title) {
    showToast('Game title is required', 'error');
    return;
  }
  saveContent();
}

function triggerGameCoverUpload() { document.getElementById('game-cover-input').click(); }

async function handleGameCoverUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('cover', file);
  const gameSlug = siteContent.game[currentEditingGameIndex]?.slug || 'game-cover';
  form.append('bookId', `game-${gameSlug}`);
  try {
    const res = await fetch('/upload-cover', { method: 'POST', headers: { 'X-CSRF-Token': getCsrfToken() }, body: form });
    const data = await res.json();
    updateGameField('coverImage', data.path);
    const preview = document.getElementById('game-cover-preview');
    if (preview?.tagName === 'IMG') preview.src = data.path;
    else if (preview) preview.outerHTML = `<img id="game-cover-preview" class="cover-preview" src="${data.path}" style="width:140px;height:auto;">`;
    document.getElementById('game-cover-url').value = data.path;
    showToast('Game cover uploaded!');
  } catch(e) { showToast('Upload failed', 'error'); }
}

function renderGameFeatureRows(features) {
  if (!features || !features.length) return '<p style="font-size:0.78rem;color:var(--muted);">No features yet.</p>';
  return features.map((f, i) => `
    <div class="platform-row" style="grid-template-columns:60px 1fr 1fr auto;" id="gf-${i}">
      <input type="text" value="${esc(f.icon || '')}" placeholder="🎮"
        oninput="updateGameArrayField('features', ${i}, 'icon', this.value)">
      <input type="text" value="${esc(f.title || '')}" placeholder="Feature title"
        oninput="updateGameArrayField('features', ${i}, 'title', this.value)">
      <input type="text" value="${esc(f.desc || '')}" placeholder="Short description"
        oninput="updateGameArrayField('features', ${i}, 'desc', this.value)">
      <button class="btn btn-danger btn-sm" onclick="removeGameFeature(${i})">✕</button>
    </div>
  `).join('');
}

function updateGameArrayField(arrayName, index, field, value) {
  ensureGamesArray();
  if (currentEditingGameIndex >= 0) {
    siteContent.game[currentEditingGameIndex][arrayName][index][field] = value;
    markDirty();
  }
}

function addGameFeature() {
  ensureGamesArray();
  const game = siteContent.game[currentEditingGameIndex];
  if (!Array.isArray(game.features)) game.features = [];
  game.features.push({ icon: '', title: '', desc: '' });
  markDirty();
  document.getElementById('game-features-editor').innerHTML = renderGameFeatureRows(game.features);
}

function removeGameFeature(index) {
  ensureGamesArray();
  const game = siteContent.game[currentEditingGameIndex];
  if (!game.features) return;
  game.features.splice(index, 1);
  markDirty();
  document.getElementById('game-features-editor').innerHTML = renderGameFeatureRows(game.features);
}

function renderScreenshotRows(screenshots) {
  if (!screenshots || !screenshots.length) return '<p style="font-size:0.78rem;color:var(--muted);">No screenshots yet.</p>';
  return screenshots.map((s, i) => `
    <div class="form-row" style="margin-bottom:0.5rem;align-items:center;">
      <div style="flex:2">
        <input type="text" value="${esc(s.path || '')}" placeholder="/covers/..."
          oninput="updateGameArrayField('screenshots', ${i}, 'path', this.value)">
      </div>
      <div style="flex:1">
        <input type="text" value="${esc(s.caption || '')}" placeholder="Caption"
          oninput="updateGameArrayField('screenshots', ${i}, 'caption', this.value)">
      </div>
      <button class="btn btn-danger btn-sm" onclick="removeScreenshot(${i})">✕</button>
    </div>
  `).join('');
}

function addScreenshot() {
  ensureGamesArray();
  const game = siteContent.game[currentEditingGameIndex];
  if (!Array.isArray(game.screenshots)) game.screenshots = [];
  game.screenshots.push({ path: '', caption: '' });
  markDirty();
  document.getElementById('game-screenshots-editor').innerHTML = renderScreenshotRows(game.screenshots);
}

function removeScreenshot(index) {
  ensureGamesArray();
  const game = siteContent.game[currentEditingGameIndex];
  if (!game.screenshots) return;
  game.screenshots.splice(index, 1);
  markDirty();
  document.getElementById('game-screenshots-editor').innerHTML = renderScreenshotRows(game.screenshots);
}

function renderDevlogRows(devlog) {
  if (!devlog || !devlog.length) return '<p style="font-size:0.78rem;color:var(--muted);">No devlog entries yet.</p>';
  return devlog.map((d, i) => `
    <div class="book-editor" style="margin-bottom:0.75rem;padding:1rem;">
      <div class="form-row" style="gap:0.5rem;margin-bottom:0.5rem;">
        <div style="flex:1">
          <label style="font-size:0.7rem;">Date</label>
          <input type="text" value="${esc(d.date || '')}" placeholder="April 2026"
            oninput="updateGameArrayField('devlog', ${i}, 'date', this.value)">
        </div>
        <button class="btn btn-danger btn-sm" onclick="removeDevlogEntry(${i})" style="margin-top:1.1rem;">✕</button>
      </div>
      <label style="font-size:0.7rem;">Title</label>
      <input type="text" value="${esc(d.title || '')}" placeholder="Update title"
        oninput="updateGameArrayField('devlog', ${i}, 'title', this.value)">
      <label style="font-size:0.7rem;margin-top:0.5rem;">Body</label>
      <textarea rows="3" placeholder="Description..."
        oninput="updateGameArrayField('devlog', ${i}, 'body', this.value)">${esc(d.body || '')}</textarea>
    </div>
  `).join('');
}

function addDevlogEntry() {
  ensureGamesArray();
  const game = siteContent.game[currentEditingGameIndex];
  if (!Array.isArray(game.devlog)) game.devlog = [];
  game.devlog.push({ date: '', title: '', body: '' });
  markDirty();
  document.getElementById('game-devlog-editor').innerHTML = renderDevlogRows(game.devlog);
}

function removeDevlogEntry(index) {
  ensureGamesArray();
  const game = siteContent.game[currentEditingGameIndex];
  if (!game.devlog) return;
  game.devlog.splice(index, 1);
  markDirty();
  document.getElementById('game-devlog-editor').innerHTML = renderDevlogRows(game.devlog);
}


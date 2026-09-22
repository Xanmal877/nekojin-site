/* Admin panel: lore */
// ── LORE & CHARACTERS LOGIC ────────────────────────────────

let currentEditingCharId = null;
let currentEditingLoreId = null;
let currentEditingTimelineId = null;
let timelineData = [];

function switchLoreSubTab(tab) {
  const isChars = tab === 'chars';
  const isLore = tab === 'lore';
  const isTimeline = tab === 'timeline';

  document.getElementById('lore-sub-chars').style.display = isChars ? 'block' : 'none';
  document.getElementById('lore-sub-lore').style.display = isLore ? 'block' : 'none';
  document.getElementById('lore-sub-timeline').style.display = isTimeline ? 'block' : 'none';

  document.getElementById('tab-chars-btn').className = isChars ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('tab-lore-btn').className = isLore ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('tab-timeline-btn').className = isTimeline ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
}

async function renderCharacters() {
  const container = document.getElementById('characters-list');
  try {
    const res = await fetch('/api/characters');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const chars = await res.json();

    if (chars.length === 0) {
      container.innerHTML = '<div class="empty-state">No characters found.</div>';
      return;
    }

    container.innerHTML = chars.map(c => `
      <div class="game-list-item">
        ${c.image
          ? `<img class="game-list-thumb" src="${esc(c.image)}" style="border-radius:50%;">`
          : `<div class="game-list-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--surface3);font-size:1.5rem;border-radius:50%;">${esc(c.emoji || '👤')}</div>`}
        <div class="game-list-info">
          <div class="game-list-title">${esc(c.emoji || '')} ${esc(c.name)} <small style="color:var(--muted);font-size:0.75rem;">(${esc(c.char_type || '')})</small></div>
          <div class="game-list-status">${esc(c.title || 'No title')} • ${c.visible ? 'Visible' : 'Hidden'}${homeSeriesLabel(c)}</div>
        </div>
        <div class="game-list-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit" data-slug="${esc(c.slug)}" title="Edit">✏️</button>
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${esc(c.id)}" title="Delete">🗑️</button>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'edit') editCharacter(btn.dataset.slug);
        else if (btn.dataset.action === 'delete') deleteCharacter(btn.dataset.id);
      });
    });
  } catch(e) {
    container.innerHTML = `<p style="color:var(--red);">Error loading characters: ${e.message}</p>`;
  }
}

async function renderLoreTopics() {
  const container = document.getElementById('lore-topics-list');
  try {
    const res = await fetch('/api/lore-topics');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const topics = await res.json();

    if (topics.length === 0) {
      container.innerHTML = '<div class="empty-state">No lore topics found.</div>';
      return;
    }

    container.innerHTML = topics.map(t => `
      <div class="game-list-item">
        <div class="game-list-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--surface3);font-size:1.5rem;">📜</div>
        <div class="game-list-info">
          <div class="game-list-title">${esc(t.title)}</div>
          <div class="game-list-status">${esc(t.section)} • ${t.visible ? 'Visible' : 'Hidden'}</div>
        </div>
        <div class="game-list-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit" data-slug="${esc(t.slug)}" title="Edit">✏️</button>
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${esc(t.id)}" title="Delete">🗑️</button>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'edit') editLoreTopic(btn.dataset.slug);
        else if (btn.dataset.action === 'delete') deleteLoreTopic(btn.dataset.id);
      });
    });
  } catch(e) {
    container.innerHTML = `<p style="color:var(--red);">Error loading lore: ${e.message}</p>`;
  }
}

function homeSeriesLabel(c) {
  const home = (c.appearances || []).find(a => a.is_home);
  if (!home) return '';
  const series = (siteContent.series || []).find(s => s.id === home.series_id);
  return ` • ${esc(series ? series.universe : home.series_id)}`;
}

function populateSeriesSelect(select, selectedId) {
  const options = (siteContent.series || []).map(s =>
    `<option value="${esc(s.id)}" ${s.id === selectedId ? 'selected' : ''}>${esc(s.universe)}</option>`
  ).join('');
  select.innerHTML = `<option value="">None / universe-wide</option>${options}`;
}

function filterCharacters(term) {
  const t = term.toLowerCase();
  document.querySelectorAll('#characters-list .game-list-item').forEach(el => {
    const text = el.textContent.toLowerCase();
    el.style.display = (!t || text.includes(t)) ? '' : 'none';
  });
}

function filterLore(term) {
  const t = term.toLowerCase();
  document.querySelectorAll('#lore-topics-list .game-list-item').forEach(el => {
    const text = el.textContent.toLowerCase();
    el.style.display = (!t || text.includes(t)) ? '' : 'none';
  });
}

async function openAddCharacterModal() {
  currentEditingCharId = null;
  document.getElementById('char-modal-title').textContent = 'Add Character';
  document.getElementById('char-name').value = '';
  document.getElementById('char-slug').value = '';
  document.getElementById('char-title').value = '';
  document.getElementById('char-species').value = '';
  document.getElementById('char-emoji').value = '';
  document.getElementById('char-image').value = '';
  document.getElementById('char-content').value = '';
  document.getElementById('char-sort').value = '0';
  document.getElementById('char-visible').checked = true;
  document.getElementById('char-cast-group').value = '';
  populateSeriesSelect(document.getElementById('char-home-series'), '');
  document.getElementById('char-appearance-rows').innerHTML = '';
  document.getElementById('char-rel-rows').innerHTML = '';
  document.getElementById('char-modal').style.display = 'flex';
}

async function editCharacter(slug) {
  try {
    const res = await fetch(`/api/characters/${slug}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const char = await res.json();

    currentEditingCharId = char.id;
    document.getElementById('char-modal-title').textContent = 'Edit Character';
    document.getElementById('char-name').value = char.name || '';
    document.getElementById('char-slug').value = char.slug || '';
    document.getElementById('char-title').value = char.title || '';
    document.getElementById('char-type').value = char.char_type || 'Character';
    document.getElementById('char-species').value = char.species || '';
    document.getElementById('char-emoji').value = char.emoji || '';
    document.getElementById('char-image').value = char.image || '';
    document.getElementById('char-content').value = char.content || '';
    document.getElementById('char-sort').value = char.sort_order || 0;
    document.getElementById('char-visible').checked = !!char.visible;

    // Render existing relationships
    const relRows = document.getElementById('char-rel-rows');
    relRows.innerHTML = '';
    const relationships = char.relationships || [];
    relationships.forEach(rel => addRelationshipRow(rel));

    // Split appearances into the home series (own fields) and guest rows
    const appearances = char.appearances || [];
    const home = appearances.find(a => a.is_home);
    populateSeriesSelect(document.getElementById('char-home-series'), home ? home.series_id : '');
    document.getElementById('char-cast-group').value = home ? (home.cast_group || '') : '';
    const appearanceRows = document.getElementById('char-appearance-rows');
    appearanceRows.innerHTML = '';
    appearances.filter(a => !a.is_home).forEach(a => addAppearanceRow(a));

    document.getElementById('char-modal').style.display = 'flex';
  } catch(e) {
    showToast('Failed to load character: ' + e.message, 'error');
  }
}

function closeCharModal() {
  document.getElementById('char-modal').style.display = 'none';
}

async function saveCharacter() {
  const data = {
    id: currentEditingCharId || 'char-' + Date.now(),
    name: document.getElementById('char-name').value.trim(),
    slug: document.getElementById('char-slug').value.trim().toLowerCase(),
    title: document.getElementById('char-title').value.trim(),
    char_type: document.getElementById('char-type').value,
    species: document.getElementById('char-species').value.trim(),
    emoji: document.getElementById('char-emoji').value.trim(),
    image: document.getElementById('char-image').value.trim(),
    content: document.getElementById('char-content').value,
    sort_order: parseInt(document.getElementById('char-sort').value) || 0,
    visible: document.getElementById('char-visible').checked
  };

  // Read relationships from the UI and resolve character names from loaded content
  const relRows = document.querySelectorAll('#char-rel-rows .rel-row');
  const relationships = [];

  // Fetch available characters to resolve slugs to names (minimal load)
  let availableCharacters = [];
  try {
    const res = await fetch('/api/characters');
    if (res.ok) availableCharacters = await res.json();
  } catch (e) {
    console.warn('Could not fetch characters for relationship name resolution:', e);
  }

  // Build a map of slug -> name for quick lookup
  const slugToName = {};
  availableCharacters.forEach(c => {
    slugToName[c.slug] = c.name;
  });

  relRows.forEach(row => {
    const slug = row.querySelector('.rel-slug').value.trim();
    const type = row.querySelector('.rel-type').value.trim();
    const desc = row.querySelector('.rel-desc').value.trim();
    if (slug) {
      relationships.push({
        character_slug: slug,
        character_name: slugToName[slug] || slug,
        relationship_type: type,
        description: desc
      });
    }
  });
  data.relationships = relationships;

  if (!data.name || !data.slug) {
    showToast('Name and slug are required', 'error');
    return;
  }

  // Home series (from its own fields) + guest appearance rows
  const homeSeriesId = document.getElementById('char-home-series').value;
  const appearances = [];
  if (homeSeriesId) {
    appearances.push({
      series_id: homeSeriesId,
      cast_group: document.getElementById('char-cast-group').value.trim(),
      is_home: true
    });
  }
  document.querySelectorAll('#char-appearance-rows .appearance-row').forEach(row => {
    const seriesId = row.querySelector('.appearance-series').value;
    const castGroup = row.querySelector('.appearance-group').value.trim();
    if (seriesId) appearances.push({ series_id: seriesId, cast_group: castGroup, is_home: false });
  });

  try {
    const res = await fetch('/api/characters', {
      method: currentEditingCharId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const appearRes = await fetch(`/api/characters/${data.id}/appearances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ appearances })
    });
    if (!appearRes.ok) throw new Error(`HTTP ${appearRes.status}`);

    showToast('Character saved successfully', 'success');
    closeCharModal();
    await renderCharacters();
  } catch(e) {
    showToast('Error saving character: ' + e.message, 'error');
  }
}

async function deleteCharacter(id) {
  if (!confirm('Are you sure you want to delete this character?')) return;
  try {
    const res = await fetch(`/api/characters/${id}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': getCsrfToken() }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast('Character deleted', 'success');
    await renderCharacters();
  } catch(e) {
    showToast('Error deleting character: ' + e.message, 'error');
  }
}

async function addRelationshipRow(data = {}) {
  const container = document.getElementById('char-rel-rows');
  const row = document.createElement('div');
  row.className = 'rel-row platform-row';

  const res = await fetch('/api/characters');
  const chars = await res.json();
  const options = chars.map(c => `<option value="${esc(c.slug)}" ${data.character_slug === c.slug ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  row.innerHTML = `
    <select class="rel-slug">
      <option value="">-- Select Character --</option>
      ${options}
    </select>
    <input type="text" class="rel-type" placeholder="Type" value="${esc(data.relationship_type || '')}">
    <input type="text" class="rel-desc" placeholder="Description" value="${esc(data.description || '')}">
    <button class="btn-icon danger" onclick="this.parentElement.remove()">🗑️</button>
  `;
  container.appendChild(row);
}

function addAppearanceRow(data = {}) {
  const container = document.getElementById('char-appearance-rows');
  const row = document.createElement('div');
  row.className = 'appearance-row platform-row';

  const options = (siteContent.series || []).map(s =>
    `<option value="${esc(s.id)}" ${data.series_id === s.id ? 'selected' : ''}>${esc(s.universe)}</option>`
  ).join('');

  row.innerHTML = `
    <select class="appearance-series">
      <option value="">-- Select Series --</option>
      ${options}
    </select>
    <input type="text" class="appearance-group" placeholder="Cast group, e.g. Golems / Cosmic Agents" value="${esc(data.cast_group || '')}">
    <button class="btn-icon danger" onclick="this.parentElement.remove()">🗑️</button>
  `;
  container.appendChild(row);
}

async function openAddLoreModal() {
  currentEditingLoreId = null;
  document.getElementById('lore-modal-title').textContent = 'Add Lore Topic';
  document.getElementById('lore-title').value = '';
  document.getElementById('lore-slug').value = '';
  document.getElementById('lore-section').value = 'world';
  document.getElementById('lore-content').value = '';
  document.getElementById('lore-sort').value = '0';
  document.getElementById('lore-visible').checked = true;
  document.getElementById('lore-modal').style.display = 'flex';
}

function closeLoreModal() {
  document.getElementById('lore-modal').style.display = 'none';
}

async function editLoreTopic(slug) {
  try {
    const res = await fetch(`/api/lore-topics/${slug}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const topic = await res.json();

    currentEditingLoreId = topic.id;
    document.getElementById('lore-modal-title').textContent = 'Edit Lore Topic';
    document.getElementById('lore-title').value = topic.title || '';
    document.getElementById('lore-slug').value = topic.slug || '';
    document.getElementById('lore-section').value = topic.section || 'world';
    document.getElementById('lore-content').value = topic.content || '';
    document.getElementById('lore-sort').value = topic.sort_order || 0;
    document.getElementById('lore-visible').checked = !!topic.visible;

    document.getElementById('lore-modal').style.display = 'flex';
  } catch(e) {
    showToast('Failed to load lore topic: ' + e.message, 'error');
  }
}

async function saveLoreTopic() {
  const data = {
    id: currentEditingLoreId || 'lore-' + Date.now(),
    title: document.getElementById('lore-title').value.trim(),
    slug: document.getElementById('lore-slug').value.trim().toLowerCase(),
    section: document.getElementById('lore-section').value,
    content: document.getElementById('lore-content').value,
    sort_order: parseInt(document.getElementById('lore-sort').value) || 0,
    visible: document.getElementById('lore-visible').checked
  };

  if (!data.title || !data.slug || !data.section) {
    showToast('Title, slug, and section are required', 'error');
    return;
  }

  try {
    const res = await fetch('/api/lore-topics', {
      method: currentEditingLoreId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast('Lore topic saved successfully', 'success');
    closeLoreModal();
    await renderLoreTopics();
  } catch(e) {
    showToast('Error saving lore topic: ' + e.message, 'error');
  }
}

async function deleteLoreTopic(id) {
  if (!confirm('Are you sure you want to delete this lore topic?')) return;
  try {
    const res = await fetch(`/api/lore-topics/${id}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': getCsrfToken() }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast('Lore topic deleted', 'success');
    await renderLoreTopics();
  } catch(e) {
    showToast('Error deleting lore topic: ' + e.message, 'error');
  }
}


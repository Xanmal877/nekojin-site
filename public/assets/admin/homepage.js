/* Admin panel: homepage */
// ── HOMEPAGE MANAGEMENT ─────────────────────────────────
let homepageSettings = {};

function updateHomepagePreview(panel, url) {
  const preview = document.getElementById(`homepage-${panel}-preview`);
  if (preview && url) {
    preview.style.backgroundImage = `url('${url}')`;
    preview.style.backgroundColor = 'var(--surface2)';
  }
}

async function handleHomepageImageUpload(input, panel) {
  const file = input.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('cover', file);
  // Use homepage-cover-{panel} naming
  form.append('bookId', `homepage-cover-${panel}`);
  try {
    const res = await fetch('/upload-cover', { method: 'POST', headers: { 'X-CSRF-Token': getCsrfToken() }, body: form });
    const data = await res.json();
    document.getElementById(`homepage-${panel}-bg`).value = data.path;
    updateHomepagePreview(panel, data.path);
    showToast('Image uploaded! Click Save to apply.');
  } catch(e) {
    showToast('Upload failed', 'error');
  }
}

// About portrait upload handler
async function handlePortraitUpload(input) {
  const file = input.files[0];
  if (!file) return;

  // Validate file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image too large. Max 5MB.', 'error');
    return;
  }

  const form = new FormData();
  form.append('cover', file);
  form.append('bookId', 'about-portrait');

  try {
    const res = await fetch('/upload-cover', { method: 'POST', headers: { 'X-CSRF-Token': getCsrfToken() }, body: form });
    const data = await res.json();

    // Update the input and preview
    document.getElementById('about-portrait-input').value = data.path;
    siteContent.about.portrait = data.path;
    markDirty();
    updateAboutPortraitPreview(data.path);
    showToast('Portrait uploaded and saved!');
  } catch(e) {
    console.error('Portrait upload failed:', e);
    showToast('Upload failed', 'error');
  }
}

// Update portrait preview in admin panel
function updateAboutPortraitPreview(path) {
  const preview = document.getElementById('about-portrait-preview');
  if (!preview) return;

  if (path) {
    preview.innerHTML = `<img src="${path}" style="width:100%;height:100%;object-fit:cover;">`;
  } else {
    preview.innerHTML = '<span style="font-size:3rem;">🏢</span>';
  }
}

async function loadHomepageSettings() {
  try {
    const res = await fetch('/api/homepage?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load: ' + res.status);
    homepageSettings = await res.json();

    // Populate form
    const xanreanInput = document.getElementById('homepage-xanrean-bg');
    const standaloneInput = document.getElementById('homepage-standalone-bg');
    const communityInput = document.getElementById('homepage-community-bg');
    const xanreanPreview = document.getElementById('homepage-xanrean-preview');
    const standalonePreview = document.getElementById('homepage-standalone-preview');
    const communityPreview = document.getElementById('homepage-community-preview');

    if (xanreanInput) {
      xanreanInput.value = homepageSettings.xanrean_bg || '/covers/homepage-cover-xanrean.webp';
      xanreanPreview.style.backgroundImage = `url('${xanreanInput.value}')`;
    }
    if (standaloneInput) {
      standaloneInput.value = homepageSettings.standalone_bg || '/covers/homepage-cover-standalone.webp';
      standalonePreview.style.backgroundImage = `url('${standaloneInput.value}')`;
    }
    if (communityInput) {
      communityInput.value = homepageSettings.community_bg || '/covers/homepage-cover-community.webp';
      communityPreview.style.backgroundImage = `url('${communityInput.value}')`;
    }
  } catch (e) {
    console.error('loadHomepageSettings error:', e);
  }
}

async function saveHomepageSettings() {
  const xanreanBg = document.getElementById('homepage-xanrean-bg').value.trim();
  const standaloneBg = document.getElementById('homepage-standalone-bg').value.trim();
  const communityBg = document.getElementById('homepage-community-bg').value.trim();
  try {
    const res = await fetch('/api/homepage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      cache: 'no-store',
      body: JSON.stringify({
        xanrean_bg: xanreanBg,
        standalone_bg: standaloneBg,
        community_bg: communityBg
      })
    });
    if (res.ok) {
      showToast('✓ Saved!');
    } else {
      showToast('Save failed', 'error');
    }
  } catch(e) {
    console.error('saveHomepageSettings error:', e);
    showToast('Save failed: ' + e.message, 'error');
  }
}

// Update preview when input changes
document.addEventListener('input', (e) => {
  if (e.target.id === 'homepage-xanrean-bg') {
    document.getElementById('homepage-xanrean-preview').style.backgroundImage = `url('${e.target.value}')`;
  }
  if (e.target.id === 'homepage-standalone-bg') {
    document.getElementById('homepage-standalone-preview').style.backgroundImage = `url('${e.target.value}')`;
  }
  if (e.target.id === 'homepage-community-bg') {
    document.getElementById('homepage-community-preview').style.backgroundImage = `url('${e.target.value}')`;
  }
});

// XANREAN SETTINGS
let xanreanSettings = {};

function updateXanreanPreview(panel, url) {
  const preview = document.getElementById(`xanrean-${panel}-preview`);
  if (preview && url) {
    preview.style.backgroundImage = `url('${url}')`;
    preview.style.backgroundColor = 'var(--surface2)';
  }
}

async function handleXanreanImageUpload(input, panel) {
  const file = input.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('cover', file);
  form.append('bookId', `xanrean-cover-${panel}`);
  try {
    const res = await fetch('/upload-cover', { method: 'POST', headers: { 'X-CSRF-Token': getCsrfToken() }, body: form });
    const data = await res.json();
    document.getElementById(`xanrean-${panel}-bg`).value = data.path;
    updateXanreanPreview(panel, data.path);
    showToast('Image uploaded! Click Save to apply.');
  } catch(e) {
    showToast('Upload failed', 'error');
  }
}

async function loadXanreanSettings() {
  try {
    const res = await fetch('/api/xanrean?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load: ' + res.status);
    xanreanSettings = await res.json();

    const panels = ['books', 'characters', 'lore', 'game'];
    panels.forEach(panel => {
      const input = document.getElementById(`xanrean-${panel}-bg`);
      const preview = document.getElementById(`xanrean-${panel}-preview`);
      if (input && preview) {
        const defaultPaths = {
          books: '/covers/xanrean-cover-books.webp',
          characters: '/covers/xanrean-cover-characters.webp',
          lore: '/covers/xanrean-cover-lore.webp',
          game: '/covers/xanrean-cover-game.webp',
        };
        const defaultPath = defaultPaths[panel];
        input.value = xanreanSettings[`${panel}_bg`] || defaultPath;
        preview.style.backgroundImage = `url('${input.value}')`;
      }
    });
  } catch (e) {
    console.error('loadXanreanSettings error:', e);
  }
}

async function saveXanreanSettings() {
  const data = {
    books_bg: document.getElementById('xanrean-books-bg').value.trim(),
    characters_bg: document.getElementById('xanrean-characters-bg').value.trim(),
    lore_bg: document.getElementById('xanrean-lore-bg').value.trim(),
    game_bg: document.getElementById('xanrean-game-bg').value.trim()
  };
  try {
    const res = await fetch('/api/xanrean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      cache: 'no-store',
      body: JSON.stringify(data)
    });
    if (res.ok) {
      showToast('✓ Saved!');
    } else {
      showToast('Save failed', 'error');
    }
  } catch(e) {
    console.error('saveXanreanSettings error:', e);
    showToast('Save failed: ' + e.message, 'error');
  }
}

// Load users when panel is shown
const _origSwitchPanel = switchPanel;
switchPanel = function(panelName) {
  _origSwitchPanel(panelName);
  if (panelName === 'users') loadUsers();
  if (panelName === 'homepage') loadHomepageSettings();
};

// User panel actions are wired through event listeners reading data attributes
// rather than inline onclick/onchange handlers that interpolate usernames into
// JavaScript source. This keeps usernames out of executable code strings.
const usersListContainer = document.getElementById('users-list-container');
if (usersListContainer) {
  usersListContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const username = btn.getAttribute('data-username');
    if (!username) return;
    if (btn.dataset.action === 'reset-password') resetUserPassword(username);
    if (btn.dataset.action === 'delete-user') deleteUser(username);
  });

  usersListContainer.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-action="change-role"]');
    if (!sel) return;
    const username = sel.getAttribute('data-username');
    if (!username) return;
    changeUserRole(username, sel.value);
  });
}

init();
loadBgSettings();

// Load users if starting on users panel
if (document.querySelector('.sidebar-item[data-panel="users"]')?.classList.contains('active')) {
  loadUsers();
}

/* Behaviour for xanrean/characters.html — moved out of the markup verbatim. */

function toggleNav() {
  const btn = document.getElementById('nav-hamburger');
  const drawer = document.getElementById('nav-drawer');
  const open = btn.classList.toggle('open');
  drawer.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}

// Minimal markdown -> HTML for the inline reader (headers, bold, italic, paragraphs)
function parseMarkdown(md) {
  // CMS content is Markdown-only; escape HTML before applying formatting.
  md = String(md || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let html = md
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^- (.*$)/gim, '<li>$1</li>')
    .replace(/^---$/gim, '<hr>');
  html = html.replace(/(<li>.*?<\/li>\n?)+/gs, m => `<ul>${m}</ul>`);
  html = html.replace(/\n\n+/g, '</p><p>');
  html = html.replace(/^(?!<[h1-6lu])/gim, '<p>');
  html = html.replace(/$(?!<\/)/gim, '</p>');
  return html;
}

const TAB_GROUPS = [
  { key: 'all', label: 'Everyone' },
  { key: 'Admin', label: 'The Admins' },
  { key: 'Moderator', label: 'The Moderators' },
  { key: 'other', label: 'Other Souls' }
];

let allChars = [];
let allSeries = [];
let filtered = [];
let activeTab = 'all';
let activeSeries = 'all';
let readerIndex = -1;

function bucketFor(charType) {
  if (charType === 'Admin' || charType === 'Moderator') return charType;
  return 'other';
}

function homeSeriesId(c) {
  const home = (c.appearances || []).find(a => a.is_home);
  return home ? home.series_id : null;
}

function applyFilter() {
  filtered = activeTab === 'all'
    ? allChars
    : allChars.filter(c => bucketFor(c.char_type) === activeTab);
  if (activeSeries !== 'all') {
    filtered = activeSeries === 'universe'
      ? filtered.filter(c => !homeSeriesId(c))
      : filtered.filter(c => homeSeriesId(c) === activeSeries);
  }
  renderDeck();
}

function renderTabs() {
  const wrap = document.getElementById('cast-tabs');
  wrap.innerHTML = TAB_GROUPS.map(t =>
    `<button class="cast-tab${t.key === activeTab ? ' active' : ''}" data-tab="${t.key}">${t.label}</button>`
  ).join('');
  wrap.querySelectorAll('.cast-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderTabs();
      applyFilter();
      closeReader();
    });
  });
}

function renderSeriesFilter() {
  const wrap = document.getElementById('cast-series-filter');
  if (!allSeries.length) { wrap.innerHTML = ''; return; }
  const options = [
    `<option value="all">All series</option>`,
    ...allSeries.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.universe)}</option>`),
    `<option value="universe">Universe-wide</option>`
  ];
  wrap.innerHTML = `<select id="cast-series-select">${options.join('')}</select>`;
  document.getElementById('cast-series-select').addEventListener('change', (e) => {
    activeSeries = e.target.value;
    applyFilter();
    closeReader();
  });
}

function cardAvatar(c) {
  return c.image
    ? `<img src="${safeMediaUrl(c.image)}" alt="${escapeHtml(c.name)}">`
    : escapeHtml(c.emoji || '👤');
}

function safeMediaUrl(value) {
  const url = String(value || '');
  return /^(\/|https?:\/\/)/i.test(url) ? escapeHtml(url) : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function renderDeck() {
  const deck = document.getElementById('cast-deck');
  if (!filtered.length) {
    deck.innerHTML = '<div class="cast-loading">No one here yet.</div>';
    return;
  }
  deck.innerHTML = filtered.map((c, i) => `
    <div class="cast-card" data-index="${i}">
      <div class="cast-avatar">${cardAvatar(c)}</div>
      <h3>${escapeHtml(c.name)}</h3>
      <div class="cast-role">${escapeHtml(c.title || c.char_type || '')}</div>
    </div>
  `).join('');
  deck.querySelectorAll('.cast-card').forEach(card => {
    card.addEventListener('click', () => openReader(parseInt(card.dataset.index, 10)));
  });
}

function openReader(index) {
  readerIndex = index;
  const c = filtered[index];
  if (!c) return;

  document.getElementById('reader-avatar').innerHTML = cardAvatar(c);
  document.getElementById('reader-name').textContent = c.name;
  document.getElementById('reader-role').textContent = c.title || c.char_type || '';
  document.getElementById('reader-body').innerHTML = parseMarkdown(c.content || '*No profile written yet.*');

  document.getElementById('reader-prev').disabled = index <= 0;
  document.getElementById('reader-next').disabled = index >= filtered.length - 1;

  document.querySelectorAll('.cast-card').forEach(card => {
    card.classList.toggle('active-card', parseInt(card.dataset.index, 10) === index);
  });

  document.getElementById('cast-reader').classList.add('visible');
  document.getElementById('cast-reader').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeReader() {
  readerIndex = -1;
  document.getElementById('cast-reader').classList.remove('visible');
  document.querySelectorAll('.cast-card').forEach(card => card.classList.remove('active-card'));
}

document.getElementById('reader-close').addEventListener('click', closeReader);
document.getElementById('reader-prev').addEventListener('click', () => {
  if (readerIndex > 0) openReader(readerIndex - 1);
});
document.getElementById('reader-next').addEventListener('click', () => {
  if (readerIndex < filtered.length - 1) openReader(readerIndex + 1);
});

document.addEventListener('keydown', (e) => {
  if (!document.getElementById('cast-reader').classList.contains('visible')) return;
  if (e.key === 'ArrowLeft' && readerIndex > 0) openReader(readerIndex - 1);
  if (e.key === 'ArrowRight' && readerIndex < filtered.length - 1) openReader(readerIndex + 1);
  if (e.key === 'Escape') closeReader();
});

async function loadCast() {
  try {
    const [charsRes, contentRes] = await Promise.all([fetch('/api/characters'), fetch('/content')]);
    allChars = await charsRes.json();
    allChars.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const content = await contentRes.json();
    allSeries = content.series || [];
    renderTabs();
    renderSeriesFilter();
    applyFilter();
  } catch (err) {
    console.error('Failed to load cast', err);
    document.getElementById('cast-deck').innerHTML = '<div class="cast-loading">Failed to load the cast. Please refresh.</div>';
  }
}
loadCast();

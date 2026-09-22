/* Behaviour for xanrean/series/cast.html — moved out of the markup verbatim. */

function toggleNav() {
  const btn = document.getElementById('nav-hamburger');
  const drawer = document.getElementById('nav-drawer');
  const open = btn.classList.toggle('open');
  drawer.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}

// Minimal markdown -> HTML for the inline reader (headers, bold, italic, paragraphs)
function parseMarkdown(md) {
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
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

// Optional per-series "also mentioned" minor cast, not backed by full
// character records. Keyed by series id.
const MINOR_CAST = {
  'the-godling-and-her-husband': [
    { name: 'Serpentina', role: 'SS-rank superhero suspected during the Godling briefing' },
    { name: 'TransferSpar', role: 'Field expert on Godlings' },
    { name: 'Marissa', role: "Doctor from Arissa's past" },
    { name: 'Dr. Rasar', role: 'Golem specialist imprisoned by the HGO' },
    { name: 'Razor', role: 'B-rank hero involved in a rescue mission' },
    { name: 'Trix', role: "Arissa's favorite cereal, and a recurring comic fixation" },
    { name: 'Tobotnik', role: 'Eccentric figure with wildlife-powered robots' },
    { name: 'Targuss', role: 'Named supporting figure in the wider setting' },
    { name: 'Timothy', role: 'Named supporting figure in the wider cast' },
  ],
  'her-majesty-tamaneko': [
    { name: 'Reedril', role: "Ancient, city-destroying-level being referenced in Saki's past" },
    { name: 'Grik', role: 'Goblin involved in a later negotiation, distinct from Grok' },
    { name: 'Kikat', role: 'Goblin involved in a dispute over slavery and goblin pride' },
    { name: 'Becka', role: 'Minor figure involved in a lost recording-pen incident' },
    { name: 'Emberly', role: 'Named supporting figure in the wider cast' },
    { name: 'Rex', role: 'Named supporting figure in the wider cast' },
    { name: 'Jabrome', role: 'Lich, central early-series undead antagonist' },
    { name: 'Sarah Liturgis', role: 'Demon Queen referenced in the early undead conflict' },
    { name: 'Crivar', role: 'Extremely fast/powerful combatant known to Tama' },
    { name: 'Corsis', role: 'Green dragon involved in conflicts around Crivar' },
    { name: 'Archduke Persip "Parsnip"', role: 'Trissaile noble and political critic' },
    { name: 'Trixua', role: 'Goblin city manager / City Keeper' },
    { name: 'Paige', role: "Part of Tama's early confrontation with slavery and consent" },
    { name: 'Dramun', role: 'Figure/artifact tied to the Serenity and Dramun arc' },
  ],
};

// Group display order follows the two source docs' own recommended
// structure. Any cast_group not listed here (a future series with its own
// groups) just sorts after these, in first-encounter order.
const GROUP_ORDER = [
  'Main Cast', 'Inner Circle', 'Household / Wife Games',
  'Golems / Cosmic Agents', 'Royal / Political', 'Powerful Allies / Wildcards',
  'HGO / Heroes', 'Fixers / Mission Contacts', 'Antagonists / Opposition',
  'Companions / Sentient Artifacts', 'Alien / Later-arc Cast',
];

let seriesId = '';
let allChars = [];
let filtered = [];
let groups = [];
let readerIndex = -1;

function appearanceFor(c) {
  return (c.appearances || []).find(a => a.series_id === seriesId);
}

function buildGroups() {
  const order = [];
  const byGroup = {};
  filtered.forEach(c => {
    const label = (appearanceFor(c) || {}).cast_group || 'Cast';
    if (!byGroup[label]) { byGroup[label] = []; order.push(label); }
    byGroup[label].push(c);
  });
  order.sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a), bi = GROUP_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  groups = order.map(label => ({ label, members: byGroup[label] }));
}

function renderGroups() {
  const container = document.getElementById('cast-groups');
  if (!filtered.length) {
    container.innerHTML = '<div class="cast-loading">No cast added for this series yet.</div>';
    return;
  }
  container.innerHTML = groups.map(g => `
    <section class="cast-group-section">
      <h2 class="cast-group-title">${escapeHtml(g.label)}</h2>
      <div class="cast-deck">
        ${g.members.map(c => `
          <div class="cast-card" data-index="${filtered.indexOf(c)}">
            <div class="cast-avatar">${cardAvatar(c)}</div>
            <h3>${escapeHtml(c.name)}</h3>
            <div class="cast-role">${escapeHtml(c.title || c.char_type || '')}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `).join('');
  container.querySelectorAll('.cast-card').forEach(card => {
    card.addEventListener('click', () => openReader(parseInt(card.dataset.index, 10)));
  });
}

function renderMinorList() {
  const list = MINOR_CAST[seriesId];
  const wrap = document.getElementById('cast-minor-list');
  if (!list || !list.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <h2 class="cast-group-title">Also mentioned</h2>
    <div class="cast-minor-grid">
      ${list.map(m => `<div class="cast-minor-item"><strong>${escapeHtml(m.name)}</strong> — ${escapeHtml(m.role)}</div>`).join('')}
    </div>
  `;
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
  const parts = window.location.pathname.split('/');
  seriesId = parts[parts.length - 2];

  try {
    const [charsRes, contentRes] = await Promise.all([fetch('/api/characters'), fetch('/content')]);
    allChars = await charsRes.json();
    const content = await contentRes.json();
    const series = (content.series || []).find(s => s.id === seriesId);

    document.getElementById('cast-hero-title').innerHTML =
      `${series ? escapeHtml(series.universe) : 'Series'} <span class="accent">Cast</span>`;
    document.title = `${series ? series.universe : 'Series'} Cast - Xanrean Chronicles`;

    filtered = allChars
      .filter(c => (c.appearances || []).some(a => a.series_id === seriesId))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    buildGroups();
    renderGroups();
    renderMinorList();
  } catch (err) {
    console.error('Failed to load cast', err);
    document.getElementById('cast-groups').innerHTML = '<div class="cast-loading">Failed to load the cast. Please refresh.</div>';
  }
}
loadCast();

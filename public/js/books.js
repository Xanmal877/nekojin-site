/* Behaviour for books.html — moved out of the markup verbatim. */
// Load footer tagline
fetch('/content')
  .then(r => r.json())
  .then(data => {
    if (data.about && data.about.tagline) {
      document.getElementById('footer-tagline').textContent = data.about.tagline;
    }
  })
  .catch(() => {});

const PLAT_LABEL = { rr: 'Royal Road', sh: 'ScribbleHub', wp: 'Wattpad', kdp: 'Kindle', gumroad: 'Gumroad' };

function platLabel(p) {
  return PLAT_LABEL[p.type] || p.name || p.type || 'Read';
}

function renderPlatforms(platforms) {
  if (!platforms || !platforms.length) return `<span class="no-platforms">Links coming soon</span>`;
  return platforms.filter(p => p.url).map(p => `
    <a href="${safeUrl(p.url)}" target="_blank" rel="noopener"
       class="plat-btn ${esc(p.type || 'other')}">${esc(platLabel(p))}</a>
  `).join('');
}

function renderBook(book) {
  const cover = book.cover
    ? `<img src="${safeUrl(book.cover)}" alt="${esc(book.title)} cover" loading="lazy">`
    : `<div class="book-cover-placeholder"><span>📖</span></div>`;

  const tags = (book.tags || []).map(t => `<span class="book-tag">${esc(t)}</span>`).join('');

  return `
    <div class="book-card" data-book-id="${esc(book.id)}">
      <div class="book-cover-wrap">${cover}</div>
      <div class="book-body">
        ${book.volume ? `<div class="book-volume">${esc(book.volume)}</div>` : ''}
        <h3 class="book-title">${esc(book.title)}</h3>
        <p class="book-desc">${esc(book.blurb || book.description)}</p>
        ${tags ? `<div class="book-tags">${tags}</div>` : ''}
        <div class="book-platforms">${renderPlatforms(book.platforms)}</div>
      </div>
    </div>
  `;
}

const revealObs = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target); } });
}, { threshold: 0.08, rootMargin: '0px 0px -20px 0px' });

function goBook(id, ev) {
  if (ev) {
    const t = ev.target.closest('a');
    if (t) return;
  }
  location.href = '/book?id=' + encodeURIComponent(id);
}

// Card navigation, delegated. The id comes from the data attribute rather than
// an inline onclick="goBook('...')" — a stored id can no longer break out of the
// attribute or inject script, and links inside a card keep working because
// goBook bails out when the click landed on one.
document.addEventListener('click', function(e) {
  const card = e.target.closest('.book-card');
  if (!card || !card.dataset.bookId) return;
  goBook(card.dataset.bookId, e);
});

async function loadBooks() {
  const container = document.getElementById('books-container');
  try {
    const res = await fetch('/content');
    const data = await res.json();

    const allBooks = (data.books || []).filter(b => b.visible !== false);

    const series = (data.series || []).filter(s => s.visible !== false)
      .map(s => ({ ...s, _books: allBooks.filter(b => b.series_id === s.id || b.id === s.id) }))
      .filter(s => s._books.length > 0);
    const seriesIds = new Set(series.map(s => s.id));

    const standalone = allBooks.filter(b => !b.series_id && !seriesIds.has(b.id));

    if (!series.length && !standalone.length) {
      container.innerHTML = '<p style="text-align:center;color:var(--muted);padding:4rem 0;">No books available yet.</p>';
      return;
    }

    let html = '';

    // ── SERIES ──
    series.forEach((s, si) => {
      html += `
        <div class="series-block reveal">
          <div class="series-header">
            <div style="display:flex;gap:1rem;align-items:center;">
              ${s.cover_image ? `<img src="${safeUrl(s.cover_image)}" class="series-cover" alt="${esc(s.universe)} cover">` : ''}
              <div>
                <span class="series-eyebrow">Series ${si + 1}</span>
                <h2 class="series-name">${esc(s.universe)}</h2>
              </div>
            </div>
            ${s.universeDesc ? `<p class="series-desc">${esc(s.universeDesc)}</p>` : ''}
          </div>
          <div class="book-grid">
            ${s._books.map((b, bi) => `<div class="reveal reveal-d${Math.min(bi + 1, 4)}">${renderBook(b)}</div>`).join('')}
          </div>
        </div>
      `;
    });

    // ── STANDALONE ──
    if (standalone.length) {
      html += `
        <div id="standalone" class="standalone-header reveal">
          <span class="standalone-eyebrow">Standalone</span>
          <h2 class="standalone-title">Books Outside Series</h2>
        </div>
        <div class="book-grid reveal">
          ${standalone.map((b, i) => `<div class="reveal reveal-d${Math.min(i + 1, 4)}">${renderBook(b)}</div>`).join('')}
        </div>
      `;
    }

    // ── NO PATREON BANNER HERE ──
    // Patreon moved to home page

    container.innerHTML = html;

    // Footer tagline
    if (data.about && data.about.tagline) {
      document.getElementById('footer-tagline').textContent = data.about.tagline;
    }

    // Trigger reveal observers on new elements
    container.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

    // The browser's native #hash scroll fires before this content exists
    // (it's rendered async after fetch), so it silently no-ops on load.
    // Do it ourselves once the target is actually in the DOM.
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
    }

  } catch(e) {
    container.innerHTML = '<p style="text-align:center;color:var(--muted);padding:4rem 0;">Could not load books.</p>';
    console.error(e);
  }
}


function toggleNav() {
  const btn = document.getElementById('nav-hamburger');
  const drawer = document.getElementById('nav-drawer');
  const open = btn.classList.toggle('open');
  drawer.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
document.addEventListener('click', function(e) {
  const btn = document.getElementById('nav-hamburger');
  const drawer = document.getElementById('nav-drawer');
  if (btn && drawer && !btn.contains(e.target) && !drawer.contains(e.target)) {
    btn.classList.remove('open'); drawer.classList.remove('open'); document.body.style.overflow = '';
  }
});
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.nav-drawer a').forEach(a => {
    a.addEventListener('click', () => {
      document.getElementById('nav-hamburger').classList.remove('open');
      document.getElementById('nav-drawer').classList.remove('open');
      document.body.style.overflow = '';
    });
  });
});

// ── SITE SEARCH ────────────────────────────────────────
(async function() {
  let searchIndex = [];
  try {
    const res = await fetch('/content');
    const data = await res.json();
    searchIndex = (data.books || []).filter(b => b.visible !== false).map(b => ({
      id: b.id,
      title: b.title,
      volume: b.volume || '',
      description: b.blurb || b.description || '',
      tags: (b.tags || []).join(' '),
      cover: b.cover || ''
    }));
  } catch(e) { console.warn('Search init failed', e); }

  function setupSearch(inputId, resultsId) {
    const input = document.getElementById(inputId);
    const results = document.getElementById(resultsId);
    if (!input || !results) return;


    function render(q) {
      q = q.trim().toLowerCase();
      if (!q || !searchIndex.length) { results.classList.remove('visible'); return; }
      const matches = searchIndex.filter(b =>
        b.title.toLowerCase().includes(q) ||
        (b.blurb || b.description || '').toLowerCase().includes(q) ||
        b.tags.toLowerCase().includes(q) ||
        b.volume.toLowerCase().includes(q)
      ).slice(0, 6);

      if (!matches.length) {
        results.innerHTML = '<div class="sr-empty">No results</div>';
      } else {
        results.innerHTML = matches.map(b => `
          <a href="/book?id=${encodeURIComponent(b.id)}" class="sr-item" onclick="document.querySelectorAll('.nav-search-results,.drawer-search-results').forEach(r=>r.classList.remove('visible'));document.getElementById('nav-drawer').classList.remove('open');document.body.style.overflow='';document.getElementById('nav-hamburger').classList.remove('open')">
            ${b.cover ? `<img src="${safeUrl(b.cover)}" alt="">` : '<div style="width:32px;height:48px;background:linear-gradient(160deg,#2d1065,#1e1b4b);border-radius:4px;flex-shrink:0;"></div>'}
            <div>
              <div class="sr-title">${esc(b.title)}</div>
              <div class="sr-meta">${esc(b.volume || b.tags.slice(0, 30) || 'Book')}</div>
            </div>
          </a>
        `).join('');
      }
      results.classList.add('visible');
    }

    let debounce;
    input.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => render(e.target.value), 150);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; results.classList.remove('visible'); input.blur(); }
    });
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !results.contains(e.target)) results.classList.remove('visible');
    });
  }

  setupSearch('nav-search', 'nav-search-results');
  setupSearch('drawer-search', 'drawer-search-results');
})();

loadBooks();

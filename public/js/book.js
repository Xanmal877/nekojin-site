/* Behaviour for book.html — moved out of the markup verbatim. */
// Load footer tagline
fetch('/content')
  .then(r => r.json())
  .then(data => {
    if (data.about && data.about.tagline) {
      document.getElementById('footer-tagline').textContent = data.about.tagline;
    }
  })
  .catch(() => {});


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
    // Index standalone books + series books
    const standalone = (data.books || []).filter(b => b.visible !== false);
    const seriesBooks = (data.series || []).filter(s => s.visible !== false).flatMap(s => (s.books || []).filter(b => b.visible !== false));
    searchIndex = [...standalone, ...seriesBooks].map(b => ({
      id: b.id, title: b.title, volume: b.volume || '',
      description: b.blurb || b.description || '', tags: (b.tags || []).join(' '), cover: b.cover || ''
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
        b.title.toLowerCase().includes(q) || (b.blurb || b.description || '').toLowerCase().includes(q) ||
        b.tags.toLowerCase().includes(q) || b.volume.toLowerCase().includes(q)
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

const PLAT_CTA_CLASS = { rr: 'cta-rr', sh: 'cta-sh', kdp: 'cta-kdp', wp: 'cta-wp', gumroad: 'cta-gumroad' };
const PLAT_CTA_LABEL = { rr: '📖 Royal Road', sh: '📖 ScribbleHub', kdp: '📚 Kindle', wp: '📖 Wattpad', gumroad: '🛒 Gumroad' };

// Renamed book ids. "the-bedrock" turned out to be a series title, not a book —
// its volume 1 is "The Foundation". Keep old links working rather than 404ing.
const LEGACY_SLUG_ALIASES = { 'the-bedrock': 'the-foundation' };

async function loadBook() {
  const params = new URLSearchParams(location.search);
  const bookId = params.get('id');
  const preview = params.get('preview') === '1';
  const container = document.getElementById('book-container');

  if (!bookId) {
    container.innerHTML = `
      <div class="book-not-found">
        <h2>📖 Book not found</h2>
        <p>No book ID was provided.</p>
        <a href="/books">← Browse all books</a>
      </div>`;
    return;
  }

  let book, data;
  // Hoisted so the "More Books" section below can read it. It was previously
  // declared with `const` inside the else block, which scoped it out of reach
  // of the `typeof allBooks` guard, so the section never rendered.
  let allBooks = [];
  try {
    if (preview) {
      // Preview mode uses a dedicated endpoint so preview books aren't
      // exposed through the regular public catalog.
      const res = await fetch(`/book-by-slug?slug=${encodeURIComponent(bookId)}&preview=1`);
      if (!res.ok) throw new Error('Preview book not found');
      const single = await res.json();
      book = single.book;
      data = {};
    } else {
      const res = await fetch('/content');
      data = await res.json();
      const standaloneBooks = (data.books || []).filter(b => b.visible !== false);
      const seriesBooks = (data.series || []).filter(s => s.visible !== false).flatMap(s => (s.books || []).filter(b => b.visible !== false));
      allBooks = [...standaloneBooks, ...seriesBooks];
      book = allBooks.find(b => b.id === bookId || b.slug === bookId);
      // Slugs that were renamed keep working: old inbound links, bookmarks and
      // search results still point at the previous id.
      if (!book) {
        const alias = LEGACY_SLUG_ALIASES[bookId];
        if (alias) book = allBooks.find(b => b.id === alias || b.slug === alias);
      }
    }
  } catch(e) {
    container.innerHTML = '<div style="text-align:center;padding:8rem 2rem;color:var(--muted);">Failed to load book data.</div>';
    return;
  }

  if (!book) {
    container.innerHTML = `
      <div class="book-not-found">
        <h2>📖 Book not found</h2>
        <p>We couldn't find a book with that ID.</p>
        <a href="/books">← Browse all books</a>
      </div>`;
    return;
  }

  // Update page title & meta
  document.title = book.title + ' - Nekojin Interactive';
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.content = esc(book.title) + ' - Nekojin Interactive';
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.content = esc((book.description || '').slice(0, 200)) + '…';
  const ogImg = document.querySelector('meta[property="og:image"]');
  if (ogImg && book.cover) ogImg.content = 'https://worldofxanrea.com' + book.cover;

  const tags = (book.tags || []).map(t => `<span class="book-hero-tag">${esc(t)}</span>`).join('');

  const ctas = (book.platforms || []).filter(p => p.url).map(p => {
    const cls = PLAT_CTA_CLASS[p.type] || 'cta-' + (p.type || 'other');
    const label = PLAT_CTA_LABEL[p.type] || (p.name || 'Read');
    const url = safeUrl(p.url);
    return `<a href="${url}" target="_blank" rel="noopener" class="${cls}">${esc(label)}</a>`;
  }).join('');

  // DISABLED: Manuscript reading system hidden (Option 1 - can re-enable later)
  // const readBtn = `<a href="/read?book=${encodeURIComponent(book.slug || book.id)}" class="cta-read">📖 Read Preview</a>`;
  const readBtn = ''; // Removed to focus on external platform links

  container.innerHTML = `
    <div class="book-hero">
      <div class="book-hero-cover">
        ${book.cover
          ? `<img src="${safeUrl(book.cover)}" alt="${esc(book.title)} cover">`
          : `<div class="placeholder">📖</div>`
        }
      </div>
      <div class="book-hero-info">
        <a href="${params.get('from') === 'xanrean' ? '/xanrean/books' : '/books'}" class="back-link">← ${params.get('from') === 'xanrean' ? 'Back to Xanrean Chronicles' : 'All Books'}</a>
        ${book.volume ? `<div class="book-hero-vol">${esc(book.volume)}</div>` : ''}
        <h1 class="book-hero-title">${esc(book.title)}</h1>
        ${tags ? `<div class="book-hero-tags">${tags}</div>` : ''}
        <p class="book-hero-desc">${esc(book.description)}</p>
        <div class="book-hero-cta">${ctas}</div>
        ${book.series_id ? `<a href="/xanrean/series/${esc(book.series_id)}/cast" class="back-link" style="display:inline-block;margin-top:1rem;">Meet the Cast →</a>` : ''}
      </div>
    </div>
  `;

  // Footer tagline
  if (data.about && data.about.tagline) {
    document.getElementById('footer-tagline').textContent = data.about.tagline;
  }

  // More books (skip in preview mode; the preview endpoint only returns one book)
  if (!preview && typeof allBooks !== 'undefined') {
  const others = allBooks.filter(b => b.id !== bookId && b.slug !== bookId).slice(0, 4);
  if (others.length) {
    const moreSection = document.getElementById('more-section');
    const moreGrid = document.getElementById('more-grid');
    moreGrid.innerHTML = others.map(b => `
      <a href="/book?id=${encodeURIComponent(b.id)}" class="more-card">
        <div class="more-cover">
          ${b.cover ? `<img src="${safeUrl(b.cover)}" alt="${esc(b.title)} cover" loading="lazy">`
            : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:3rem;">📖</div>'}
        </div>
        <div class="more-info">
          <div class="more-name">${esc(b.title)}</div>
        </div>
      </a>
    `).join('');
    moreSection.style.display = '';
  }
  }
}

loadBook();

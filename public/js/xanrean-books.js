/* Behaviour for xanrean/books.html — moved out of the markup verbatim. */

document.getElementById('theme-icon').textContent =
  (document.documentElement.getAttribute('data-theme') === 'dark') ? '🌙' : '☀️';

// Format word count
function formatCount(n) {
  if (n >= 1000) return (n/1000).toFixed(1) + 'k';
  return String(n);
}

// Escape HTML

function renderBookCard(book) {
  // A book with status "published" but no purchase/read links attached
  // isn't actually out yet, so badge it as upcoming rather than claiming
  // it's published when there's nowhere to get it.
  const hasLinks = (book.platforms || []).some(p => p.url);
  const rawStatus = !hasLinks ? 'draft' : (book.status || 'draft');
  // Map to a fixed allowlist so a stored status string can never inject
  // markup into the class attribute or the badge label.
  const statusClass = ['published', 'preview', 'draft'].includes(rawStatus) ? rawStatus : 'draft';
  const statusLabel = { published: 'Published', preview: 'Preview', draft: 'Coming Soon' }[statusClass] || statusClass;
  const words = book.word_count ? `${formatCount(book.word_count)} words` : '';
  const vol = book.volume ? book.volume : (book.volume_number ? `Vol. ${book.volume_number}` : '');
  const cover = String(book.cover || '/images/placeholder-cover.png');
  const safeCover = (/^(?:https?:\/\/|\/(?!\/))/.test(cover) && !/[\s"'()\\<>`]/.test(cover))
    ? cover
    : '/images/placeholder-cover.png';
  const blurb = book.blurb || book.description || '';

  return `
    <a href="/book?id=${esc(book.slug)}&from=xanrean" class="book-card">
      <div class="book-cover" style="background-image: url('${safeCover}')">
        <span class="book-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="book-info">
        ${vol ? `<div class="book-volume">${esc(vol)}</div>` : ''}
        <h3 class="book-title">${esc(book.title)}</h3>
        <p class="book-blurb">${esc(blurb).slice(0, 120)}${blurb.length > 120 ? '...' : ''}</p>
        <div class="book-meta">
          ${words ? `<span>📝 ${words}</span>` : ''}
        </div>
      </div>
    </a>
  `;
}

function groupSection({ id, badge, badgeClass, heading, blurb, books }) {
  if (!books.length) return '';
  return `
    <section class="tier-section" id="${esc(id)}">
      <div class="tier-header">
        <div class="tier-badge ${badgeClass}">${badge}</div>
        <h2>${esc(heading)}</h2>
        ${blurb ? `<p>${esc(blurb)}</p>` : ''}
      </div>
      <div class="books-grid">
        ${books.map(renderBookCard).join('')}
      </div>
    </section>
  `;
}

function emptyState(icon, msg) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <p>${esc(msg)}</p>
    </div>
  `;
}

// Load the catalog and render the hierarchy:
//   Xanrean Chronicles (master)
//     ├─ series sections (HMT, The Bedrock, GHH, ...)
//     ├─ Novella Standalones
//     └─ Omnibuses
async function loadBooks() {
  const groupsEl = document.getElementById('groups');
  try {
    const res = await fetch('/content');
    const data = await res.json();

    const byVolume = (a, b) =>
      (a.volume_number || 0) - (b.volume_number || 0) ||
      String(a.title || '').localeCompare(String(b.title || ''));

    const books = (data.books || []).filter(b => b.visible !== false).sort(byVolume);
    const seriesList = (data.series || [])
      .filter(s => s.visible !== false)
      .slice()
      .sort((a, b) =>
        (a.sort_order || 0) - (b.sort_order || 0) ||
        String(a.name || '').localeCompare(String(b.name || '')));

    const sections = [];

    // One section per series, in the series' own reading order.
    for (const s of seriesList) {
      const inSeries = books.filter(b =>
        b.series_id === s.id && (b.tier === 'series' || (!b.tier && b.volume_number)));
      if (!inSeries.length) continue;
      sections.push(groupSection({
        id: `series-${s.id}`,
        badge: '📖 Series',
        badgeClass: 'series',
        heading: s.name,
        blurb: s.universeDesc || s.description || '',
        books: inSeries,
      }));
    }

    // Novellas that stand alone inside the master series.
    sections.push(groupSection({
      id: 'novellas',
      badge: '✨ Novella Standalones',
      badgeClass: 'novella',
      heading: 'Novella Standalones',
      blurb: 'Self-contained stories, no prior reading required.',
      books: books.filter(b => b.tier === 'novella'),
    }));

    // Collected editions.
    sections.push(groupSection({
      id: 'omnibuses',
      badge: '📚 Omnibuses',
      badgeClass: 'omnibus',
      heading: 'Omnibuses',
      blurb: 'Complete arcs collected in a single volume.',
      books: books.filter(b => b.tier === 'omnibus'),
    }));

    const rendered = sections.join('').trim();
    groupsEl.innerHTML = rendered || emptyState('📚', 'The collection is being catalogued. Check back soon.');

    // Jump-nav, built from whatever actually rendered (no dead anchors).
    document.getElementById('series-jump').innerHTML = [...groupsEl.querySelectorAll('.tier-section')]
      .map(sec => `<a href="#${sec.id}">${esc(sec.querySelector('h2').textContent)}</a>`)
      .join('');

  } catch (e) {
    console.error('Failed to load books:', e);
    groupsEl.innerHTML = emptyState('⚠️', 'Failed to load books. Please try again later.');
  }
}

// Load books on page load
loadBooks();

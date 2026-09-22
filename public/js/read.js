/* Behaviour for read.html — moved out of the markup verbatim. */
(function() {
  'use strict';

  const params = new URLSearchParams(location.search);
  const slug = params.get('book');
  const startChapter = parseInt(params.get('chapter'), 10) || 1;

  if (!slug) {
    document.getElementById('reader-wrap').innerHTML = '<div class="error">No book specified. Go to <a href="/books" style="color:var(--accent2)">Books</a>.</div>';
    return;
  }

  let chapters = [];
  let currentNum = startChapter;
  let bookInfo = null;

  async function init() {
    try {
      // Load book info from site content (check top-level books and series)
      const contentRes = await fetch('/content');
      const content = await contentRes.json();
      bookInfo = findBook(content, slug);
      if (bookInfo) {
        document.getElementById('book-title').textContent = bookInfo.title || slug;
        document.title = (bookInfo.title || slug) + ' - Nekojin Interactive';
      }

      // Load chapters
      const chapRes = await fetch(`/api/manuscripts/${encodeURIComponent(slug)}/chapters`);
      if (!chapRes.ok) throw new Error('No manuscript found');
      const data = await chapRes.json();
      chapters = data.chapters || [];

      if (!chapters.length) throw new Error('No chapters found');

      buildToc();
      await loadChapter(currentNum);
    } catch (err) {
      document.getElementById('reader-wrap').innerHTML = `<div class="error">${err.message}<br><br>No manuscript found for <code>${slug}.docx</code>.<br>Place your .docx in the <code>manuscripts/</code> folder.</div>`;
    }
  }

  function findBook(content, slug) {
    let book = content.books?.find(b => b.id === slug || b.slug === slug);
    if (book) return book;
    for (const s of content.series || []) {
      book = s.books?.find(b => b.id === slug || b.slug === slug);
      if (book) return book;
    }
    return null;
  }

  function getCtaPlatform() {
    const platforms = bookInfo?.platforms || [];
    const preferred = bookInfo?.ctaPlatform || 'kdp';
    return platforms.find(p => p.type === preferred) || platforms.find(p => p.type === 'kdp') || platforms[0] || null;
  }

  function getOtherPlatforms() {
    const primary = getCtaPlatform();
    const platforms = bookInfo?.platforms || [];
    return platforms.filter(p => p !== primary);
  }

  async function loadChapter(num) {
    const ch = chapters.find(c => c.num === num);
    if (!ch) return;
    currentNum = num;

    const wrap = document.getElementById('reader-wrap');
    wrap.innerHTML = '<div class="loading">Loading chapter…</div>';

    try {
      const res = await fetch(`/api/manuscripts/${encodeURIComponent(slug)}/chapters/${num}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();

      let html = `<div class="chapter-heading">Chapter ${data.num}</div>
        <h1 class="chapter-title-display">${escapeHtml(data.title || ('Chapter ' + data.num))}</h1>
        <div class="chapter-body">${escapeHtml(data.content || '')}</div>`;

      // Navigation: use array index for reliable prev/next
      const idx = chapters.findIndex(c => c.num === num);
      const prev = idx > 0 ? chapters[idx - 1] : null;
      const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;
      const isLastPreview = idx >= 2 && chapters.length > 3;

      const primary = getCtaPlatform();
      const others = getOtherPlatforms();

      html += `<div class="chapter-nav">`;
      if (prev) {
        html += `<a href="?book=${encodeURIComponent(slug)}&chapter=${prev.num}" onclick="return navTo(${prev.num})">
          <div><div class="nav-label">Previous</div><div class="nav-chapter">${escapeHtml(prev.title || ('Chapter ' + prev.num))}</div></div>
        </a>`;
      } else {
        html += `<a href="/book?id=${encodeURIComponent(slug)}" style="opacity:0.6">
          <div><div class="nav-label">Back to</div><div class="nav-chapter">Book Details</div></div>
        </a>`;
      }

      if (next && !isLastPreview) {
        html += `<a href="?book=${encodeURIComponent(slug)}&chapter=${next.num}" onclick="return navTo(${next.num})" style="text-align:right">
          <div><div class="nav-label">Next</div><div class="nav-chapter">${escapeHtml(next.title || ('Chapter ' + next.num))}</div></div>
        </a>`;
      } else if (isLastPreview && primary) {
         html += `<div style="text-align:right"><a href="${safeExternalUrl(primary.url)}" target="_blank" rel="noopener" class="cta-btn">Continue on ${escapeHtml(primary.name)} →</a></div>`;
      } else {
        html += `<span></span>`;
      }
      html += `</div>`;

      // CTA banner for preview end
      if (isLastPreview && primary) {
        html += `<div class="cta-banner">
          <h4>End of preview</h4>
          <p>This book continues on ${escapeHtml(primary.name)}. Thanks for reading!</p>
           <a href="${safeExternalUrl(primary.url)}" target="_blank" rel="noopener" class="cta-btn">Continue Reading →</a>`;
        if (others.length) {
          html += `<div style="margin-top:1rem;font-size:0.78rem;color:var(--muted);">Also available on ` +
             others.map(p => `<a href="${safeExternalUrl(p.url)}" target="_blank" rel="noopener" style="color:var(--accent2);text-decoration:underline;">${escapeHtml(p.name)}</a>`).join(', ') +
            `</div>`;
        }
        html += `</div>`;
      }

      wrap.innerHTML = html;
      document.getElementById('header-chapter-title').textContent = data.title || ('Chapter ' + data.num);
      updateButtons();
      updateTocActive();
      window.scrollTo(0, 0);

      // Update URL without reload
      const newUrl = `?book=${encodeURIComponent(slug)}&chapter=${num}`;
      history.replaceState(null, '', newUrl);
    } catch (err) {
      wrap.innerHTML = `<div class="error">Failed to load chapter: ${err.message}</div>`;
    }
  }

  function buildToc() {
    const list = document.getElementById('toc-list');
    list.innerHTML = chapters.map(c => `
      <div class="toc-item ${c.num === currentNum ? 'active' : ''}" data-num="${c.num}" onclick="navTo(${c.num}); closeToc();">
        <span class="num">${c.num}</span>
        <span class="name">${escapeHtml(c.title || ('Chapter ' + c.num))}</span>
      </div>
    `).join('');
  }

  function updateTocActive() {
    document.querySelectorAll('.toc-item').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.num) === currentNum);
    });
  }

  function updateButtons() {
    const idx = chapters.findIndex(c => c.num === currentNum);
    const hasPrev = idx > 0;
    const hasNext = idx >= 0 && idx < 2 && idx < chapters.length - 1;
    document.getElementById('btn-prev').disabled = !hasPrev;
    document.getElementById('btn-next').disabled = !hasNext;
  }

  window.goPrev = function() {
    const idx = chapters.findIndex(c => c.num === currentNum);
    if (idx > 0) loadChapter(chapters[idx - 1].num);
  };
  window.goNext = function() {
    const idx = chapters.findIndex(c => c.num === currentNum);
    if (idx >= 0 && idx < 2 && idx < chapters.length - 1) loadChapter(chapters[idx + 1].num);
  };
  window.navTo = function(num) {
    loadChapter(num);
    return false;
  };
  window.openToc = function() {
    document.getElementById('toc-panel').classList.add('open');
    document.getElementById('toc-overlay').classList.add('open');
  };
  window.closeToc = function() {
    document.getElementById('toc-panel').classList.remove('open');
    document.getElementById('toc-overlay').classList.remove('open');
  };

  // Scroll progress
  window.addEventListener('scroll', () => {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    document.getElementById('progress-bar').style.width = pct + '%';
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function safeExternalUrl(value) {
    const url = String(value || '');
    return /^(https?:\/\/)/i.test(url) ? escapeHtml(url) : '#';
  }

  init();
})();

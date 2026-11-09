/* Games page: reveal-on-scroll, key-art tilt, backdrop parallax, the
   screenshot lightbox, plus the shared nav drawer and site search. */

// Footer tagline from the site content
fetch('/content')
  .then(r => r.json())
  .then(data => {
    if (data.about && data.about.tagline) {
      document.getElementById('footer-tagline').textContent = data.about.tagline;
    }
  })
  .catch(() => {});

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── REVEAL ON SCROLL ──────────────────────────────────────
(function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (reducedMotion || !('IntersectionObserver' in window)) {
    els.forEach(el => el.classList.add('visible'));
    return;
  }
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach((el, i) => {
    // stagger siblings inside the same grid
    el.style.transitionDelay = (Array.from(el.parentNode.children).indexOf(el) % 6) * 70 + 'ms';
    obs.observe(el);
  });
})();

// ── KEY ART TILT ──────────────────────────────────────────
(function initTilt() {
  if (reducedMotion || !window.matchMedia('(hover: hover)').matches) return;
  document.querySelectorAll('[data-tilt]').forEach(card => {
    const base = getComputedStyle(card).getPropertyValue('--ry').trim() || '-6deg';
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--ry', (x * 14).toFixed(2) + 'deg');
      card.style.setProperty('--rx', (-y * 10).toFixed(2) + 'deg');
    });
    card.addEventListener('mouseleave', () => {
      card.style.setProperty('--ry', base);
      card.style.removeProperty('--rx');
    });
  });
})();

// ── BACKDROP PARALLAX ─────────────────────────────────────
(function initParallax() {
  if (reducedMotion) return;
  const layers = Array.from(document.querySelectorAll('.gx-backdrop'));
  if (!layers.length) return;
  let ticking = false;
  function update() {
    const vh = window.innerHeight;
    layers.forEach(layer => {
      const r = layer.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      // clamp so the scaled layer never slides far enough to expose an edge
      const progress = Math.max(-1, Math.min(1, (r.top + r.height / 2 - vh / 2) / vh));
      layer.style.transform = `scale(1.12) translateY(${(progress * -30).toFixed(1)}px)`;
    });
    ticking = false;
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
})();

// ── LIGHTBOX ──────────────────────────────────────────────
(function initLightbox() {
  const box = document.getElementById('gx-lightbox');
  const img = document.getElementById('gx-lb-img');
  const cap = document.getElementById('gx-lb-cap');
  if (!box) return;
  let group = [];
  let index = 0;
  let opener = null;

  function show(i) {
    index = (i + group.length) % group.length;
    const shot = group[index];
    img.src = shot.dataset.full;
    img.alt = shot.querySelector('img')?.alt || '';
    cap.textContent = shot.dataset.caption || '';
  }
  function open(shot) {
    group = Array.from(shot.closest('.gx-gallery').querySelectorAll('.gx-shot'));
    opener = shot;
    show(group.indexOf(shot));
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    box.querySelector('.gx-lb-close').focus();
  }
  function close() {
    box.hidden = true;
    img.removeAttribute('src');
    document.body.style.overflow = '';
    if (opener) opener.focus();
  }

  document.querySelectorAll('.gx-shot').forEach(shot => {
    shot.setAttribute('data-caption', shot.dataset.caption || '');
    shot.addEventListener('click', () => open(shot));
  });
  box.querySelector('.gx-lb-close').addEventListener('click', close);
  box.querySelector('.gx-lb-prev').addEventListener('click', () => show(index - 1));
  box.querySelector('.gx-lb-next').addEventListener('click', () => show(index + 1));
  box.addEventListener('click', e => { if (e.target === box) close(); });
  document.addEventListener('keydown', e => {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
  });
})();

// ── NAV DRAWER ────────────────────────────────────────────
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
  if (btn && drawer && !btn.contains(e.target) && !drawer.contains(e.target) && drawer.classList.contains('open')) {
    btn.classList.remove('open'); drawer.classList.remove('open'); document.body.style.overflow = '';
  }
});
document.querySelectorAll('.nav-drawer a').forEach(a => {
  a.addEventListener('click', () => {
    document.getElementById('nav-hamburger').classList.remove('open');
    document.getElementById('nav-drawer').classList.remove('open');
    document.body.style.overflow = '';
  });
});

// ── SITE SEARCH ───────────────────────────────────────────
(async function() {
  let searchIndex = [];
  try {
    const res = await fetch('/content');
    const data = await res.json();
    searchIndex = (data.books || []).filter(b => b.visible !== false).map(b => ({
      id: b.id,
      title: b.title,
      volume: b.volume || '',
      description: b.description || '',
      tags: (b.tags || []).join(' '),
      cover: b.cover || ''
    }));
  } catch (e) { console.warn('Search init failed', e); }

  function closeAll() {
    document.querySelectorAll('.nav-search-results,.drawer-search-results').forEach(r => r.classList.remove('visible'));
    document.getElementById('nav-drawer').classList.remove('open');
    document.getElementById('nav-hamburger').classList.remove('open');
    document.body.style.overflow = '';
  }

  function setupSearch(inputId, resultsId) {
    const input = document.getElementById(inputId);
    const results = document.getElementById(resultsId);
    if (!input || !results) return;

    function render(q) {
      q = q.trim().toLowerCase();
      if (!q || !searchIndex.length) { results.classList.remove('visible'); return; }
      const matches = searchIndex.filter(b =>
        b.title.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.tags.toLowerCase().includes(q) ||
        b.volume.toLowerCase().includes(q)
      ).slice(0, 6);

      if (!matches.length) {
        results.innerHTML = '<div class="sr-empty">No results</div>';
      } else {
        results.innerHTML = matches.map(b => `
          <a href="/book?id=${encodeURIComponent(b.id)}" class="sr-item">
            ${b.cover ? `<img src="${safeUrl(b.cover)}" alt="">` : '<div style="width:32px;height:48px;background:linear-gradient(160deg,#2d1065,#1e1b4b);border-radius:4px;flex-shrink:0;"></div>'}
            <div>
              <div class="sr-title">${esc(b.title)}</div>
              <div class="sr-meta">${esc(b.volume || b.tags.slice(0, 30) || 'Book')}</div>
            </div>
          </a>
        `).join('');
        results.querySelectorAll('.sr-item').forEach(a => a.addEventListener('click', closeAll));
      }
      results.classList.add('visible');
    }

    let timer;
    input.addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(() => render(e.target.value), 150);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { input.value = ''; results.classList.remove('visible'); input.blur(); }
    });
    document.addEventListener('click', e => {
      if (!input.contains(e.target) && !results.contains(e.target)) results.classList.remove('visible');
    });
  }

  setupSearch('nav-search', 'nav-search-results');
  setupSearch('drawer-search', 'drawer-search-results');
})();

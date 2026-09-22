/* Games page: data loading, rendering, and interactions. */
// Load footer tagline
fetch('/content')
  .then(r => r.json())
  .then(data => {
    if (data.about && data.about.tagline) {
      document.getElementById('footer-tagline').textContent = data.about.tagline;
    }
  })
  .catch(() => {});

const revealObs = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target); } });
}, { threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

// Map a stored game status to a fixed allowlist of CSS classes. Unknown or
// malicious values fall back to the default "in-development" styling so a
// stored status string can never inject markup into the class attribute.
function statusClassFor(status) {
  const s = String(status || '').toLowerCase().replace(/\s+/g, '-');
  return ['in-development', 'released', 'early-access'].includes(s) ? s : 'in-development';
}

function formatGameDesc(desc, title) {
  if (!desc) return '';
  const lines = desc.split('\n');
  let start = 0;
  if (lines[0].includes(title)) start = 1;
  const body = lines.slice(start).join('\n');
  return body.split(/\n\n+/).filter(p => p.trim()).map(p => {
    const text = esc(p.trim()).replace(/\n/g, ' ');
    if (text.length < 60 && !text.includes('.') && !text.includes('?') && !text.includes('!')) {
      return '<h4>' + text + '</h4>';
    }
    return '<p>' + text + '</p>';
  }).join('');
}

// ── HERO PARTICLE SYSTEM ───────────────────────────────
(function initHeroParticles() {
  const canvas = document.getElementById('hero-particles');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let particles = [];
  let animationId;
  let isActive = true;

  function resize() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }

  function createParticle() {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2 + 0.5,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: (Math.random() - 0.5) * 0.3,
      opacity: Math.random() * 0.5 + 0.2,
      pulse: Math.random() * Math.PI * 2
    };
  }

  function init() {
    resize();
    particles = [];
    const particleCount = Math.min(100, Math.floor((canvas.width * canvas.height) / 8000));
    for (let i = 0; i < particleCount; i++) {
      particles.push(createParticle());
    }
  }

  function draw() {
    if (!isActive) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach((p, i) => {
      // Update position
      p.x += p.speedX;
      p.y += p.speedY;
      p.pulse += 0.02;

      // Wrap around edges
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;

      // Draw particle with pulse
      const pulseOpacity = p.opacity * (0.7 + 0.3 * Math.sin(p.pulse));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(196, 181, 253, ${pulseOpacity})`;
      ctx.fill();

      // Draw connections to nearby particles
      particles.slice(i + 1).forEach(p2 => {
        const dx = p.x - p2.x;
        const dy = p.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 100) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(124, 58, 237, ${0.1 * (1 - dist / 100)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      });
    });

    animationId = requestAnimationFrame(draw);
  }

  // Handle resize
  window.addEventListener('resize', resize);

  // Pause when tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      isActive = false;
      cancelAnimationFrame(animationId);
    } else {
      isActive = true;
      draw();
    }
  });

  init();
  draw();
})();

// ── PARALLAX EFFECT ──────────────────────────────────
(function initParallax() {
  const layers = document.querySelectorAll('.hero-parallax-layer');
  if (!layers.length) return;

  let ticking = false;

  function updateParallax() {
    const scrolled = window.scrollY;
    const heroHeight = document.getElementById('games-hero')?.offsetHeight || window.innerHeight;

    if (scrolled < heroHeight) {
      layers.forEach((layer, index) => {
        const speed = (index + 1) * 0.15;
        const yPos = scrolled * speed;
        layer.style.transform = `translateY(${yPos}px)`;
      });
    }

    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(updateParallax);
      ticking = true;
    }
  });
})();

// ── HERO DATA LOADING ────────────────────────────────
async function loadGame() {
  try {
    const res = await fetch('/content');
    if (!res.ok) return;
    const data = await res.json();
    const g = data.game;
    if (!g) return;

    // Support multiple games array or single game object, and respect the
    // admin-panel visibility toggle (hidden games are still sent in /content,
    // same pattern as books, filtered client-side).
    const allGames = (Array.isArray(g) ? g : [g]).filter(Boolean);
    const games = allGames.filter(gm => gm.visible !== false);

    // Hero: keep the studio branding (don't override with game data)
    // The hero now shows Nekojin Interactive LLC with your bio
    const firstGame = games[0];

    // ── RENDER GAMES LIST (supports multiple games) ─────────
    const gamesContainer = document.getElementById('games-container');
    if (gamesContainer && g) {

      if (games.length === 0) {
        gamesContainer.innerHTML = `
          <div class="game-card-placeholder">
            <div class="placeholder-art">
              <span class="placeholder-icon">🎮</span>
              <span class="placeholder-label">No games announced yet</span>
            </div>
          </div>
        `;
      } else {
        gamesContainer.innerHTML = games.map((game, index) => {
          const isFeatured = index === 0;
          const cardClass = isFeatured ? 'featured' : 'compact';

          // Status badge — map to a fixed allowlist so an arbitrary stored
          // status string can never inject markup into the class attribute.
          const statusClass = statusClassFor(game.status);
          const statusPulse = statusClass === 'released' ? '' : '<span class="status-pulse"></span>';

          // Cover art
          const artHtml = game.coverImage
            ? `<img src="${safeUrl(game.coverImage)}" alt="${esc(game.title)} cover" loading="lazy">`
            : `<div class="game-card-art-placeholder">
                 <span class="art-placeholder-icon">${esc(game.icon || '🎮')}</span>
                 <span class="art-placeholder-text">Key Art in Progress</span>
               </div>`;

          // Meta items
          const metaItems = [
            game.engine && `<span class="game-card-meta-item"><strong>${esc(game.engine)}</strong></span>`,
            game.players && `<span class="game-card-meta-item">${esc(game.players)}</span>`,
            game.platform && `<span class="game-card-meta-item">${esc(game.platform)}</span>`
          ].filter(Boolean).join('');

          // Platform buttons with smart labeling based on status
          const rawStatus = String(game.status || '').toLowerCase().replace(/\s+/g, '-');
          const isReleased = ['released', 'available', 'launched'].includes(rawStatus);
          const hasDemo = game.demoUrl || (game.platforms?.demo && game.platforms.demo !== '');

          // Define button labels based on status
          const getSteamLabel = () => {
            if (hasDemo && !isReleased) return 'Try Steam Demo';
            if (isReleased) return 'Get on Steam';
            return 'Wishlist on Steam';
          };
          const getItchLabel = () => {
            if (hasDemo && !isReleased) return 'Try Demo on Itch.io';
            if (isReleased) return 'Get on Itch.io';
            return 'Get on Itch.io';
          };
          const getGOGLabel = () => {
            if (hasDemo && !isReleased) return 'Try GOG Demo';
            if (isReleased) return 'Buy on GOG';
            return 'Wishlist on GOG';
          };
          const getEpicLabel = () => {
            if (hasDemo && !isReleased) return 'Try Epic Demo';
            if (isReleased) return 'Get on Epic';
            return 'Wishlist on Epic';
          };

          const platformButtons = [];

          // Steam
          if (game.steamUrl || game.platforms?.steam) {
            const url = game.steamUrl || game.platforms?.steam;
            platformButtons.push(`<a href="${safeUrl(url)}" target="_blank" rel="noopener" class="btn-wishlist-primary btn-steam">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15h-2v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3l-.5 3H13v6.95c5.05-.5 9-4.76 9-9.95 0-5.52-4.48-10-10-10z"/></svg>
              ${getSteamLabel()}
            </a>`);
          }

          // Itch.io
          if (game.itchUrl || game.platforms?.itch) {
            const url = game.itchUrl || game.platforms?.itch;
            platformButtons.push(`<a href="${safeUrl(url)}" target="_blank" rel="noopener" class="btn-wishlist-primary btn-itch">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M4 2h16c1.1 0 2 .9 2 2v16c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2zm8 4c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/></svg>
              ${getItchLabel()}
            </a>`);
          }

          // GOG
          if (game.gogUrl || game.platforms?.gog) {
            const url = game.gogUrl || game.platforms?.gog;
            platformButtons.push(`<a href="${safeUrl(url)}" target="_blank" rel="noopener" class="btn-wishlist-primary btn-gog">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              ${getGOGLabel()}
            </a>`);
          }

          // Epic Games Store
          if (game.epicUrl || game.platforms?.epic) {
            const url = game.epicUrl || game.platforms?.epic;
            platformButtons.push(`<a href="${safeUrl(url)}" target="_blank" rel="noopener" class="btn-wishlist-primary btn-epic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>
              ${getEpicLabel()}
            </a>`);
          }

          // Dedicated demo button (if demoUrl set separately)
          if (hasDemo && !game.platforms?.steam && !game.platforms?.itch) {
            platformButtons.push(`<a href="${safeUrl(game.demoUrl || game.platforms.demo)}" target="_blank" rel="noopener" class="btn-wishlist-primary btn-demo"
               style="background: linear-gradient(135deg, #f59e0b, #d97706);"
            >
              🎮 Try Demo
            </a>`);
          }

          // Generic/custom platform
          if (game.platforms) {
            Object.entries(game.platforms).forEach(([name, url]) => {
              if (['steam', 'itch', 'gog', 'epic', 'demo'].includes(name)) return;
              if (typeof url === 'string') {
                platformButtons.push(`<a href="${safeUrl(url)}" target="_blank" rel="noopener" class="btn-wishlist-primary btn-platform">
                  ${esc(name.charAt(0).toUpperCase() + name.slice(1))}
                </a>`);
              }
            });
          }

          // If no platforms, show Coming Soon
          if (platformButtons.length === 0) {
            platformButtons.push(`<button class="btn-wishlist-primary disabled" disabled>
              🎮 Coming Soon
            </button>`);
          }

          const platformsHtml = platformButtons.join('');

          return `
            <article class="game-card ${cardClass}" data-game-id="${esc(game.id || game.slug || 'main')}">
              <div class="game-card-info">
                <div class="game-card-status ${statusClass}">
                  ${statusPulse}
                  ${esc(game.status || 'In Development')}
                </div>
                <h2 class="game-card-title">${esc(game.title)}</h2>
                <p class="game-card-tagline">${esc(game.tagline || game.subtitle || '')}</p>
                <div class="game-card-meta">${metaItems}</div>
                <div class="game-card-platforms">
                  <div class="platform-buttons">
                    ${platformsHtml}
                  </div>
                </div>
              </div>
              <div class="game-card-art">${artHtml}</div>
            </article>
          `;
        }).join('');
      }
    }

    // ── FEATURED GAME DETAILS (render into tabs) ─────────
    if (firstGame) {
      // Overview: description + system requirements
      const overviewDesc = document.getElementById('overview-description');
      if (overviewDesc) {
        if (firstGame.description) {
          overviewDesc.innerHTML = formatGameDesc(firstGame.description, firstGame.title);
        } else {
          overviewDesc.innerHTML = `<p class="overview-empty">${esc(firstGame.tagline || 'More details coming soon.')}</p>`;
        }
      }

      const reqPanel = document.getElementById('overview-requirements');
      if (reqPanel) {
        const sr = firstGame.systemRequirements || {};
        const fields = [
          { key: 'os', label: 'OS' },
          { key: 'processor', label: 'Processor' },
          { key: 'memory', label: 'Memory' },
          { key: 'graphics', label: 'Graphics' },
          { key: 'storage', label: 'Storage' },
          { key: 'directx', label: 'DirectX / Engine Notes' },
        ];
        const hasAny = fields.some(f => sr[f.key]);
        if (hasAny) {
          reqPanel.innerHTML = `
            <div class="requirements-panel">
              <div class="requirements-title">🖥️ System Requirements</div>
              <div class="requirements-list">
                ${fields.map(f => sr[f.key] ? `
                  <div class="requirement-item">
                    <span class="requirement-label">${f.label}</span>
                    <span class="requirement-value">${esc(sr[f.key])}</span>
                  </div>
                ` : '').join('')}
              </div>
            </div>
          `;
        } else {
          reqPanel.innerHTML = `
            <div class="requirements-panel">
              <div class="requirements-title">🖥️ System Requirements</div>
              <p class="requirements-placeholder">System requirements will be posted as development progresses.</p>
            </div>
          `;
        }
      }

      // Features tab
      const featGrid = document.getElementById('features-grid');
      if (featGrid) {
        if (Array.isArray(firstGame.features) && firstGame.features.length) {
          featGrid.innerHTML = firstGame.features.map((f,i) => `
            <div class="feature-card reveal reveal-d${Math.min(i+1,6)}">
              <div class="feature-icon">${esc(f.icon || '✨')}</div>
              <div class="feature-title">${esc(f.title)}</div>
              <div class="feature-desc">${esc(f.desc)}</div>
            </div>
          `).join('');
          featGrid.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
        } else {
          featGrid.innerHTML = `<p class="requirements-placeholder">Feature list coming soon.</p>`;
        }
      }

      // Media tab: video + screenshots
      const videoSection = document.getElementById('video-section');
      if (videoSection) {
        if (firstGame.videoUrl) {
          videoSection.innerHTML = `
            <div class="video-section-title">▶ Gameplay Video</div>
            <div class="video-wrapper">
              <iframe src="${safeUrl(firstGame.videoUrl)}" title="${esc(firstGame.title)} gameplay video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>
            </div>
          `;
        } else {
          videoSection.innerHTML = `
            <div class="video-section-title">▶ Gameplay Video</div>
            <div class="video-wrapper">
              <div class="video-placeholder">
                <span class="video-placeholder-icon">🎬</span>
                <span>Gameplay video coming soon.</span>
              </div>
            </div>
          `;
        }
      }

      const screenshotsGrid = document.getElementById('screenshots-grid');
      if (screenshotsGrid) {
        if (Array.isArray(firstGame.screenshots) && firstGame.screenshots.length) {
          screenshotsGrid.innerHTML = firstGame.screenshots.map((s,i) => `
            <button class="screenshot-card reveal reveal-d${Math.min(i+1,4)}" data-lightbox="${safeUrl(s.path)}" data-caption="${esc(s.caption || '')}" aria-label="View screenshot: ${esc(s.caption || 'Screenshot ' + (i+1))}" type="button">
              <img src="${safeUrl(s.path)}" alt="${esc(s.caption || '')}" loading="lazy">
              ${s.caption ? `<div class="screenshot-caption">${esc(s.caption)}</div>` : ''}
            </button>
          `).join('');
          screenshotsGrid.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
          screenshotsGrid.querySelectorAll('[data-lightbox]').forEach(btn => {
            btn.addEventListener('click', () => openLightbox(btn.dataset.lightbox, btn.dataset.caption));
          });
        } else {
          screenshotsGrid.innerHTML = `<p class="requirements-placeholder">No screenshots yet.</p>`;
        }
      }

      // Devlog tab: progress bar + entries
      const devlogProgress = document.getElementById('devlog-progress');
      if (devlogProgress) {
        let progress = typeof firstGame.progress === 'number' ? firstGame.progress : 0;
        if (progress < 0) progress = 0;
        if (progress > 100) progress = 100;
        const statusClass = statusClassFor(firstGame.status);
        if (typeof firstGame.progress !== 'number' && statusClass === 'released') progress = 100;
        devlogProgress.innerHTML = `
          <div class="devlog-progress-header">
            <span class="devlog-progress-title">Development Progress</span>
            <span class="devlog-progress-percent">${progress}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: 0%" data-width="${progress}%"></div>
          </div>
        `;
        // Animate fill after a brief delay so the transition is visible
        setTimeout(() => {
          const fill = devlogProgress.querySelector('.progress-fill');
          if (fill) fill.style.width = fill.dataset.width;
        }, 100);
      }

      const devlogList = document.getElementById('devlog-list');
      if (devlogList) {
        if (Array.isArray(firstGame.devlog) && firstGame.devlog.length) {
          devlogList.innerHTML = firstGame.devlog.map((d,i) => `
            <div class="devlog-entry reveal reveal-d${Math.min(i+1,4)}">
              <div class="devlog-date">${esc(d.date)}</div>
              <div class="devlog-title">${esc(d.title)}</div>
              <div class="devlog-desc">${esc(d.body)}</div>
            </div>
          `).join('');
          devlogList.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
        } else {
          devlogList.innerHTML = `<p class="requirements-placeholder">No devlog entries yet. Check back for updates.</p>`;
        }
      }
    }

    // Footer tagline
    if (data.about && data.about.tagline) {
      document.getElementById('footer-tagline').textContent = data.about.tagline;
    }

  } catch(e) {
    console.error('Game load failed:', e);
  }
}

// ── TAB SWITCHING ──────────────────────────────────────
function initGameTabs() {
  const tabs = document.querySelectorAll('.game-tab');
  const panels = document.querySelectorAll('.game-tab-panel');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      panels.forEach(p => {
        const isTarget = p.id === 'tab-' + target;
        p.classList.toggle('active', isTarget);
        if (isTarget) p.removeAttribute('hidden');
        else p.setAttribute('hidden', '');
      });
    });
  });
}
document.addEventListener('DOMContentLoaded', initGameTabs);

// ── LIGHTBOX ───────────────────────────────────────────
function openLightbox(src, caption) {
  let overlay = document.getElementById('games-lightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'games-lightbox';
    overlay.className = 'lightbox-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Screenshot preview');
    overlay.innerHTML = `
      <button class="lightbox-close" aria-label="Close">×</button>
      <img class="lightbox-img" src="" alt="">
      <div class="lightbox-caption"></div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeLightbox(); });
  }

  const img = overlay.querySelector('.lightbox-img');
  const cap = overlay.querySelector('.lightbox-caption');
  img.src = src;
  img.alt = caption || 'Screenshot';
  cap.textContent = caption || '';
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', lightboxKeyHandler);
}

function closeLightbox() {
  const overlay = document.getElementById('games-lightbox');
  if (overlay) {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', lightboxKeyHandler);
  }
}

function lightboxKeyHandler(e) {
  if (e.key === 'Escape') closeLightbox();
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
      description: b.description || '',
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
        b.description.toLowerCase().includes(q) ||
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

loadGame();

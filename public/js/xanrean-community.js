/* Behaviour for xanrean/community.html — moved out of the markup verbatim. */

  function toggleNav() {
    const hamburger = document.getElementById('nav-hamburger');
    const drawer = document.getElementById('nav-drawer');
    if (!hamburger || !drawer) return;
    const open = !drawer.classList.contains('open');
    drawer.classList.toggle('open', open);
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
  }

  // Initialize theme icon to reflect the theme applied in <head>
  (function initThemeIcon() {
    const icon = document.getElementById('theme-icon');
    if (!icon) return;
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    icon.textContent = current === 'dark' ? '🌙' : '☀️';
  })();

  // Format an ISO date into a friendly, human-readable string.
  function friendlyDate(input) {
    if (!input) return '';
    const d = new Date(input);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Only allow safe http(s) URLs when injecting href/src attributes.

  async function subscribe(e) {
    e.preventDefault();
    const input = e.target.querySelector('input[type="email"]');
    const btn = e.target.querySelector('button[type="submit"]');
    const msg = document.getElementById('nl-message');
    const email = input.value.trim();
    if (!email) return;
    btn.disabled = true;
    try {
      const res = await fetch('/newsletter', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email})
      });
      if (res.ok) {
        msg.className = 'nl-message visible success';
        msg.textContent = '✓ Subscribed!';
        input.value = '';
      } else {
        msg.className = 'nl-message visible error';
        msg.textContent = 'Try again later';
      }
    } catch {
      msg.className = 'nl-message visible error';
      msg.textContent = 'Network error';
    }
    btn.disabled = false;
    setTimeout(() => {
      msg.classList.remove('visible');
    }, 3000);
  }


  async function loadSales() {
    const section = document.getElementById('sales-section');
    const list = document.getElementById('sales-list');
    list.innerHTML = '<p class="loading-text">Loading supporters...</p>';
    section.style.display = 'block';
    try {
      const res = await fetch('/api/sales');
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      if (!data.sales || data.sales.length === 0) {
        list.innerHTML = '<p class="no-content">No supporters yet.</p>';
        return;
      }

      const items = data.sales.map(sale => {
        const price = (Number(sale.price_cents) / 100).toFixed(2);
        const date = sale.purchased_at ? friendlyDate(sale.purchased_at) : '';
        const dateText = date ? ` · ${esc(date)}` : '';
        return `<div class="sale-item">Someone just picked up <strong>${esc(sale.product_name)}</strong> ✦ $${esc(price)} ${esc(sale.currency)}${dateText}</div>`;
      }).join('');

      list.innerHTML = items;
    } catch (e) {
      console.error('Sales load failed:', e);
      list.innerHTML = '<p class="no-content">Sorry, we couldn\u2019t load recent supporters.</p>';
    }
  }


  async function loadVideos() {
    const grid = document.getElementById('video-grid');
    grid.innerHTML = '<p class="loading-text">Loading videos...</p>';
    try {
      const res = await fetch('/api/youtube');
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      if (!data.videos || data.videos.length === 0) {
        grid.innerHTML = '<p class="no-content">No videos yet.</p>';
        return;
      }

      const cards = data.videos.map(v => {
        const watchUrl = 'https://www.youtube.com/watch?v=' + encodeURIComponent(String(v.id || ''));
        return `
        <a href="${safeUrl(watchUrl)}" target="_blank" rel="noopener" class="video-card">
          <div class="video-thumb">
            <img src="${safeUrl(v.thumbnail)}" alt="${esc(v.title)}" loading="lazy">
          </div>
          <div class="video-info">
            <h3 class="video-title">${esc(v.title)}</h3>
            <span class="video-date">${friendlyDate(v.published)}</span>
          </div>
        </a>
      `;
      }).join('');

      grid.innerHTML = cards;
    } catch (e) {
      console.error('Videos load failed:', e);
      grid.innerHTML = '<p class="no-content">Failed to load videos.</p>';
    }
  }

  async function loadDiscord() {
    const section = document.getElementById('discord-section');
    const container = document.getElementById('discord-widget-container');
    const btn = document.getElementById('discord-join-btn');
    container.innerHTML = '<p class="loading-text">Loading Discord...</p>';
    section.style.display = 'block';
    try {
      const res = await fetch('/api/discord');
      if (!res.ok) throw new Error('API error');
      const data = await res.json();

      if (data.server_id) {
        const widgetUrl = 'https://discord.com/widget?id=' + encodeURIComponent(String(data.server_id)) + '&theme=dark';
        container.innerHTML = `
          <iframe src="${safeUrl(widgetUrl)}" title="Join the Nekojin Discord server"
                  width="350" height="500" allowtransparency="true"
                  frameborder="0" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts">
          </iframe>`;
      } else {
        container.innerHTML = '';
      }

      const inviteUrl = data.invite_url || (data.invite_code ? `https://discord.gg/${encodeURIComponent(String(data.invite_code))}` : null);
      if (inviteUrl) {
        btn.href = safeUrl(inviteUrl);
        btn.style.display = '';
      } else {
        btn.style.display = 'none';
      }

      if (!data.server_id && !inviteUrl) {
        section.style.display = 'none';
      }
    } catch (e) {
      console.error('Discord load failed:', e);
      container.innerHTML = '<p class="no-content">Sorry, Discord isn\u2019t available right now.</p>';
      btn.style.display = 'none';
    }
  }

  // Init
  loadSales();
  loadVideos();
  loadDiscord();

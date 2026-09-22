/* Behaviour for about.html — moved out of the markup verbatim. */
// Newsletter subscribe
async function subscribe(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.querySelector('input[type="email"]').value;
  const btn = form.querySelector('button');
  const msg = document.getElementById('nl-message');
  
  btn.disabled = true;
  btn.textContent = '...';
  
  try {
    const res = await fetch('/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    
    if (res.ok) {
      showToast('Subscribed! Welcome aboard.', 'success');
      form.reset();
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(data.message || 'Subscription failed', 'error');
    }
  } catch (err) {
    showToast('Network error. Please try again.', 'error');
  }
  
  btn.disabled = false;
  btn.textContent = 'Subscribe';
}

function showToast(message, type = 'success') {
  const msg = document.getElementById('nl-message');
  msg.textContent = message;
  msg.className = 'nl-message ' + type;
  msg.classList.add('visible');
  setTimeout(() => msg.classList.remove('visible'), 3000);
}

// Theme toggle

const PLATFORM_LABELS = {
  royalroad: '📖 Royal Road', scribblehub: '📚 ScribbleHub', wattpad: '✍️ Wattpad',
  patreon: '☕ Support on Patreon', kdp: '🛒 Amazon KDP', discord: '💬 Discord'
};

// Load about content from CMS
async function loadAboutContent() {
  let data;
  try {
    const res = await fetch('/content');
    if (!res.ok) return;
    data = await res.json();
  } catch (e) {
    console.error('Failed to load about content:', e);
    return;
  }

  const about = data.about;
  if (!about) return;

  // Each section runs independently so one missing element/field can't
  // abort the rest of the page from updating.
  try {
    if (about.studioName) {
      document.getElementById('page-title').textContent = about.studioName;
      document.title = 'About - ' + about.studioName;
    }
  } catch (e) { console.error('about: title', e); }

  try {
    if (about.tagline) {
      document.getElementById('page-tagline').textContent = about.tagline;
    }
  } catch (e) { console.error('about: tagline', e); }

  try {
    if (about.portrait) {
      const img = document.getElementById('about-portrait-img');
      const placeholder = document.getElementById('portrait-placeholder');
      img.src = about.portrait;
      img.style.display = 'block';
      placeholder.style.display = 'none';
    }
  } catch (e) { console.error('about: portrait', e); }

  try {
    // Update description paragraphs if provided
    const paras = [about.description, about.description2, about.description3].filter(Boolean);
    if (paras.length >= 2) {
      const textContainer = document.getElementById('about-text');
      const existingParas = textContainer.querySelectorAll('p');
      if (existingParas.length >= 3) {
        existingParas[0].textContent = paras[0];
        existingParas[1].textContent = paras[1];
        if (paras[2] && existingParas[2]) {
          existingParas[2].textContent = paras[2];
        }
      }
    }
  } catch (e) { console.error('about: description paragraphs', e); }

  try {
    if (about.universeBlurb) {
      document.getElementById('universe-blurb-text').textContent = about.universeBlurb;
      document.getElementById('universe-blurb-block').style.display = '';
    }
  } catch (e) { console.error('about: universe blurb', e); }

  try {
    const links = about.links || about.social_links || {};
    const entries = Object.entries(links).filter(([, url]) => url);
    if (entries.length > 0) {
      const container = document.getElementById('footer-links');
      container.innerHTML = entries.map(([key, url]) => {
        const label = PLATFORM_LABELS[key] || key;
        const safeUrl = /^https?:\/\//i.test(url) ? url : '#';
        return `<a href="${esc(safeUrl)}" target="_blank" rel="noopener" class="footer-patreon">${esc(label)}</a>`;
      }).join('');
    }
  } catch (e) { console.error('about: social links', e); }

  try {
    const firstGame = Array.isArray(data.game) ? data.game[0] : data.game;
    if (firstGame && firstGame.status) {
      const statusBadge = document.getElementById('status-badge');
      const statusText = document.getElementById('status-text');
      if (statusBadge && statusText) {
        statusText.textContent = firstGame.status + ' - ' + (firstGame.title || 'Latest Game');
        statusBadge.style.display = 'inline-flex';
      }
    }
  } catch (e) { console.error('about: status badge', e); }
}

// Initialize
loadAboutContent();

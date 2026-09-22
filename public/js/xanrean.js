/* Behaviour for xanrean.html — moved out of the markup verbatim. */
// Theme toggle

// Initialize theme icon
document.getElementById('theme-icon').textContent = 
  (document.documentElement.getAttribute('data-theme') || 'light') === 'light' ? '☀️' : '🌙';

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

// Load Xanrean panel background settings
(async function loadXanreanSettings() {
  try {
    const res = await fetch('/api/xanrean');
    if (!res.ok) return;
    const settings = await res.json();
    const root = document.documentElement;
    if (settings.books_bg) root.style.setProperty('--xanrean-books-bg', `url('${settings.books_bg}')`);
    if (settings.characters_bg) root.style.setProperty('--xanrean-characters-bg', `url('${settings.characters_bg}')`);
    if (settings.lore_bg) root.style.setProperty('--xanrean-lore-bg', `url('${settings.lore_bg}')`);
    if (settings.game_bg) root.style.setProperty('--xanrean-game-bg', `url('${settings.game_bg}')`);
  } catch (e) {
    console.error('Failed to load Xanrean settings:', e);
  }
})();

// Initialize
document.getElementById('theme-icon').textContent = 
  (document.documentElement.getAttribute('data-theme') || 'light') === 'light' ? '☀️' : '🌙';

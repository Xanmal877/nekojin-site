/* Behaviour for index.html — moved out of the markup verbatim. */
  // Load homepage background settings
  (async function loadHomepageSettings() {
    try {
      const res = await fetch('/api/homepage');
      if (res.ok) {
        const settings = await res.json();
        const root = document.documentElement;
        if (settings.xanrean_bg) {
          root.style.setProperty('--xanrean-bg', `url('${settings.xanrean_bg}')`);
        }
        if (settings.standalone_bg) {
          root.style.setProperty('--standalone-bg', `url('${settings.standalone_bg}')`);
        }
        if (settings.community_bg) {
          root.style.setProperty('--community-bg', `url('${settings.community_bg}')`);
        }
      } else {
        console.error('Failed to load settings, status:', res.status);
      }
    } catch (e) {
      console.error('Failed to load homepage settings:', e);
    }
  })();


  
  document.getElementById('theme-icon').textContent =
    (localStorage.getItem('theme') || 'light') === 'dark' ? '🌙' : '☀️';

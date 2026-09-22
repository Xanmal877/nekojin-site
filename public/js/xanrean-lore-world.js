/* Behaviour for xanrean/lore/world.html — moved out of the markup verbatim. */
  function parseMarkdown(md) {
    if (!md) return '';
    md = String(md).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return md
      .replace(/^# (.*$)/gim, '<h2 style="font-size:1.2rem; margin-bottom:0.5rem;">$1</h2>')
      .replace(/^## (.*$)/gim, '<h3 style="font-size:1rem; margin-bottom:0.5rem;">$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--royal-light)">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<h)/gim, '<p>')
      .replace(/$(?!<\/)/gim, '</p>')
      .split('\n').join(' ');
  }

  async function loadWorlds() {
    const grid = document.getElementById('worlds-grid');
    const loader = document.getElementById('loading');
 
    try {
      const response = await fetch('/api/lore-topics?section=world');
      const topics = await response.json();
 
      if (!topics || topics.length === 0) {
        loader.innerHTML = 'No world data found.';
        return;
      }
 
      const cards = await Promise.all(topics.map(async topic => {
        try {
          // Use a simple summary from the content (first paragraph)
          const summary = topic.content.split('\n\n')[0] || topic.content;
          
          const title = topic.title;
          
          return `
            <a href="/xanrean/lore/world/${encodeURIComponent(topic.slug)}" class="world-card">
              <h2>${escapeHtml(title)}</h2>
              <div class="md-content">
                ${parseMarkdown(summary)}
              </div>
              <div class="cta">Explore World →</div>
            </a>
          `;
        } catch (e) {
          console.error('Error loading topic ' + topic.slug, e);
          return '';
        }
      }));
 
      grid.innerHTML = cards.join('');
      grid.style.display = 'grid';
      loader.style.display = 'none';
    } catch (err) {
      console.error('Error loading worlds', err);
      loader.innerHTML = 'Failed to load world data. Please refresh.';
    }
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }


  loadWorlds();

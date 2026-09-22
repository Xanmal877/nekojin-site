/* Behaviour for xanrean/lore/timeline.html — moved out of the markup verbatim. */
    async function loadTimeline() {
      const list = document.getElementById('events-list');
      const container = document.getElementById('timeline');
      const loader = document.getElementById('loading');
      try {
        const res = await fetch('/api/timeline');
        const events = await res.json();
        if (!events || events.length === 0) {
          loader.innerHTML = 'No timeline events found.';
          return;
        }

        // Sort events by sort_order
        events.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

        // Group by era
        const groups = {};
        events.forEach(e => {
          const era = e.era || 'Unknown Era';
          if (!groups[era]) groups[era] = [];
          groups[era].push(e);
        });

        let html = '';
        for (const era in groups) {
          html += `<div style="text-align:center; margin: 2rem 0; position:relative; z-index:2;">
                    <span style="background:var(--bg); padding: 0 1rem; color:var(--royal); font-family:var(--font-display); font-size:1.5rem; border: 1px solid var(--royal); border-radius:8px;">${esc(era)}</span>
                  </div>`;
          
          html += groups[era].map(e => `
            <div class="timeline-event">
              <div class="event-card">
                <div class="event-era">${esc(e.era || 'Unknown Era')}</div>
                <h2 class="event-title">${esc(e.title)}</h2>
                <div class="event-desc">${esc(e.description)}</div>
                <div class="event-chars">
                  ${(e.related_character_slugs || []).map(slug => 
                    `<a href="/xanrean/characters/${encodeURIComponent(slug)}" class="char-tag">${esc(slug)}</a>`
                  ).join('')}
                </div>
              </div>
            </div>
          `).join('');
        }
        
        list.innerHTML = html;
        container.style.display = 'block';
        loader.style.display = 'none';
      } catch (err) {
        console.error('Error loading timeline', err);
        loader.innerHTML = 'Failed to load timeline data.';
      }
    }
    loadTimeline();


  
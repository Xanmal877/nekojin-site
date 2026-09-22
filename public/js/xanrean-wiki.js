/* Behaviour for xanrean/wiki.html — moved out of the markup verbatim. */
    // Wiki link database
    const wikiLinks = {
      // Characters - with URLs to standalone pages
      'Tama': { type: 'character', url: '/xanrean/characters/tama', title: 'Admin Creation (Tama)' },
      'Admin Creation': { type: 'character', url: '/xanrean/characters/tama', title: 'Admin Creation' },
      'Saki': { type: 'character', url: '/xanrean/characters/saki', title: 'Admin Destruction (Saki)' },
      'Admin Destruction': { type: 'character', url: '/xanrean/characters/saki', title: 'Admin Destruction' },
      'Anna': { type: 'character', file: 'moderator-time.md', title: 'Water/Anna' },
      'Xanari': { type: 'character', file: 'moderator-space.md', title: 'Xanari (Xan)' },
      'Xan': { type: 'character', file: 'moderator-space.md', title: 'Xanari' },
      
      // Species
      'Nekojin': { type: 'species', section: 'nekojin', title: 'Nekojin' },
      'Foxkin': { type: 'species', section: 'foxkin', title: 'Foxkin' },
      'Elves': { type: 'species', section: 'elves', title: 'Elves' },
      'Kitsune': { type: 'species', section: 'kitsune', title: 'Kitsune' },
      'Wolfkin': { type: 'species', section: 'wolfkin', title: 'Wolfkin' },
      'Travelers': { type: 'species', section: 'travelers', title: 'Travelers' },
      
      // Systems/Concepts
      'The Void': { type: 'concept', title: 'The Void' },
      'Serenity': { type: 'concept', title: 'Serenity (Sword)' },
      'Xanrea': { type: 'concept', title: 'Xanrea Framework' },
      'Server Clusters': { type: 'concept', title: 'Server Clusters' },
    };
    
    // Parse [[Link]] syntax
    function parseWikiLinks(text) {
      return text.replace(/\[\[([^\]]+)\]\]/g, (match, link) => {
        const page = wikiLinks[link];
        if (page) {
          return `<a href="#${link.toLowerCase().replace(/\s+/g, '-')}" class="wiki-link" data-wiki="${link}">${link}</a>`;
        }
        return `<a href="#${link.toLowerCase().replace(/\s+/g, '-')}" class="wiki-link">${link}</a>`;
      });
    }
    
    // Parse markdown
    function parseMarkdown(md) {
      md = String(md || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      let html = md
        // Headers
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        // Bold/italic
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Lists
        .replace(/^- (.*$)/gim, '<li>$1</li>')
        // HR
        .replace(/^---$/gim, '<hr>');
      
      // Add anchor ids to headers so #section links can scroll to them
      const slugify = text => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      html = html.replace(/<h([23])>(.*?)<\/h\1>/g, (match, level, text) => {
        const id = slugify(text.replace(/<[^>]+>/g, ''));
        return `<h${level} id="${id}">${text}</h${level}>`;
      });

      // Parse wiki links
      html = parseWikiLinks(html);

      // Wrap lists
      html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');
      
      // Paragraphs (after lists)
      html = html.replace(/\n\n+/g, '</p><p>');
      html = html.replace(/^(?!<[hlu])/gim, '<p>');
      html = html.replace(/$(?!<\/)/gim, '</p>');
      
      return html;
    }
    
    // Extract references from text
    function extractReferences(text) {
      const refs = [];
      const seen = new Set();
      
      for (const [key, value] of Object.entries(wikiLinks)) {
        if (text.includes(key) && !seen.has(key)) {
          refs.push({ name: key, ...value });
          seen.add(key);
        }
      }
      
      return refs.slice(0, 8); // Limit to 8 references
    }
    
    // Load wiki page
    async function loadWikiPage(pageName) {
      const content = document.getElementById('article-content');
      content.innerHTML = '<div class="loading">Loading...</div>';
      
      try {
        // Map page names to files
        const fileMap = {
          'tama': 'tama.md',
          'admin-creation': 'tama.md',
          'saki': 'saki.md',
          'admin-destruction': 'saki.md',
          'anna': 'anna.md',
          'moderator-time': 'anna.md',
          'xanari': 'xanari.md',
          'xan': 'xanari.md',
          'moderator-space': 'xanari.md',
          'acros': 'acros.md',
          'sarah': 'sarah.md',
          'moderator-chaos': 'moderator-chaos.md',
          'moderator-order': 'moderator-order.md'
        };

        // Species/lore keys live in the shared world compendium, not a
        // per-character file - loaded from /data/lore/ and scrolled to
        // their section anchor within the single article.
        const compendiumKeys = new Set([
          'compendium', 'nekojin', 'foxkin', 'elves', 'wolfkin', 'kitsune',
          'cleansweeper', 'travelers', 'the-big-picture',
          'administrative-entities', 'anna-sabi'
        ]);

        const key = pageName.toLowerCase();
        const isCompendium = compendiumKeys.has(key) || !fileMap[key];
        const file = fileMap[key];
        const path = isCompendium ? '/api/compendium' : `/api/wiki/${encodeURIComponent(file.replace(/\.md$/, ''))}`;
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const md = await response.text();

        // Parse content
        const html = parseMarkdown(md);
        content.innerHTML = `<div class="wiki-article">${html}</div>`;

        // Species/lore links land on the compendium article - scroll to
        // the requested section instead of always showing the top.
        if (isCompendium && key !== 'compendium') {
          const target = document.getElementById(key);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Extract and show references
        const refs = extractReferences(md);
        if (refs.length > 0) {
          const seeAlso = document.createElement('div');
          seeAlso.className = 'see-also';
          seeAlso.innerHTML = `
            <div class="see-also-title">📎 See Also</div>
            <div class="see-also-list">
              ${refs.map(r => {
                const link = wikiLinks[r.name];
                const href = link?.url || `#${r.name.toLowerCase().replace(/\s+/g, '-')}`;
                return `<a href="${href}" class="see-also-item">${r.title || r.name}</a>`;
              }).join('')}
            </div>
          `;
          content.querySelector('.wiki-article').appendChild(seeAlso);
        }
        
        // Update infocard
        updateInfocard(pageName, md);
        
        // Update breadcrumb
        updateBreadcrumb(pageName);
        
        // Highlight active in sidebar
        document.querySelectorAll('.wiki-nav-link').forEach(link => {
          link.classList.toggle('active', link.dataset.page === pageName);
        });
        
      } catch (err) {
        content.innerHTML = `<p>Error loading page: ${err.message}</p>`;
      }
    }
    
    function updateInfocard(pageName, content) {
      const infocard = document.getElementById('infocard');
      
      // Extract basic stats from content
      const nameMatch = content.match(/##?\s*(.+?)(?:\n|$)/);
      const ageMatch = content.match(/\*\*Age:\*\*\s*(\d+)/);
      const levelMatch = content.match(/\*\*Level:\*\*\s*(\d+)/);
      const elementMatch = content.match(/\*\*Primary Element:\*\*\s*(.+?)(?:\n|$)/);
      const speciesMatch = content.match(/\*\*Species:\*\*\s*(.+?)(?:\n|$)/);
      
      const title = nameMatch ? nameMatch[1] : pageName;
      
      infocard.innerHTML = `
        <div class="infocard">
          <div class="infocard-image">🎭</div>
          <div class="infocard-title">${title}</div>
          <div class="infocard-subtitle">${wikiLinks[title]?.type || 'Character'}</div>
          ${ageMatch ? `
            <div class="infocard-stat">
              <span class="infocard-stat-label">Age</span>
              <span>${ageMatch[1]}</span>
            </div>
          ` : ''}
          ${levelMatch ? `
            <div class="infocard-stat">
              <span class="infocard-stat-label">Level</span>
              <span>${levelMatch[1]}</span>
            </div>
          ` : ''}
          ${elementMatch ? `
            <div class="infocard-stat">
              <span class="infocard-stat-label">Element</span>
              <span>${elementMatch[1]}</span>
            </div>
          ` : ''}
          ${speciesMatch ? `
            <div class="infocard-stat">
              <span class="infocard-stat-label">Species</span>
              <span>${speciesMatch[1]}</span>
            </div>
          ` : ''}
        </div>
      `;
    }
    
    function updateBreadcrumb(pageName) {
      const crumb = document.getElementById('breadcrumb');
      const title = wikiLinks[pageName]?.title || pageName;
      crumb.innerHTML = `
        <a href="/xanrean">Xanrean Chronicles</a>
        <span>/</span>
        <a href="/xanrean/wiki">Wiki</a>
        <span>/</span>
        <span>${title}</span>
      `;
    }
    
    // Handle navigation
    document.querySelectorAll('.wiki-nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        loadWikiPage(page);
        history.pushState({ page }, '', `#${page}`);
      });
    });
    
    // Handle wiki links in content
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('wiki-link')) {
        e.preventDefault();
        const page = e.target.dataset.wiki || e.target.textContent;
        const pageKey = Object.keys(wikiLinks).find(k => k.toLowerCase() === page.toLowerCase());
        if (pageKey) {
          const link = wikiLinks[pageKey];
          if (link.type === 'species') {
            loadWikiPage(link.section);
            history.pushState({ page: link.section }, '', `#${link.section}`);
          } else if (link.type === 'character' && link.url) {
            // Redirect characters to their standalone pages
            window.location.href = link.url;
          } else {
            loadWikiPage(pageKey.toLowerCase().replace(/\s+/g, '-'));
            history.pushState({ page: pageKey }, '', `#${pageKey.toLowerCase().replace(/\s+/g, '-')}`);
          }
        }
      }
    });
    
    // Handle back/forward
    window.addEventListener('popstate', (e) => {
      if (e.state?.page) {
        loadWikiPage(e.state.page);
      }
    });

    // Handle plain #hash links (e.g. sidebar species links) that don't
    // go through the SPA click handlers above
    window.addEventListener('hashchange', () => {
      const page = window.location.hash.slice(1);
      if (page) loadWikiPage(page);
    });
    
    // Theme toggle

    document.getElementById('theme-icon').textContent = 
      (document.documentElement.getAttribute('data-theme') === 'dark') ? '🌙' : '☀️';
    
    // Load initial page
    const hash = window.location.hash.slice(1) || 'tama';
    loadWikiPage(hash);
  
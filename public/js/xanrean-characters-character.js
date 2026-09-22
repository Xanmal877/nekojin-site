/* Behaviour for xanrean/characters/character.html — moved out of the markup verbatim. */
    function getCharName() {
      const path = window.location.pathname;
      const match = path.match(/\/characters\/([^\/]+)/);
      return match ? match[1] : 'tama';
    }

    function extractInfoFromContent(md) {
      const info = {};
      
      // Try to find key info from the content
      // Look for patterns like "**Age:**" or "age:" etc.
      const ageMatch = md.match(/\*\*Age:\*\*\s*(.+?)(?:\n|$)/i) || md.match(/-?\s*\*\*Age\*\*:\s*(.+?)(?:\n|$)/i);
      if (ageMatch) info.age = ageMatch[1].trim();
      
      const speciesMatch = md.match(/\*\*Species:\*\*\s*(.+?)(?:\n|$)/i) || md.match(/species is\s+(.+?)(?:\n|\.|,|$)/i);
      if (speciesMatch) info.species = speciesMatch[1].trim();
      
      // Look for Primary/Secondary Element
      const primaryElementMatch = md.match(/\*\*Primary element:\*\*\s*(.+?)(?:\n|$)/i) || md.match(/primary element is\s+(.+?)(?:\n|\.|,|$)/i);
      const secondaryElementMatch = md.match(/\*\*Secondary element:\*\*\s*(.+?)(?:\n|$)/i) || md.match(/secondary element is\s+(.+?)(?:\n|\.|,|$)/i);
      if (primaryElementMatch) info.primaryelement = primaryElementMatch[1].trim();
      if (secondaryElementMatch) info.secondaryelement = secondaryElementMatch[1].trim();
      
      // Look for role/identity
      const roleMatch = md.match(/\*\*Role:\*\*\s*(.+?)(?:\n|$)/i) || md.match(/is (?:a|an) \*\*(.+?)\*\*(?:\n|\.|,|$)/i);
      if (roleMatch) info.role = roleMatch[1].trim();
      
      // Look for underlying identity (for incarnations)
      const identityMatch = md.match(/\*\*Underlying identity:\*\*\s*(.+?)(?:\n|$)/i) || md.match(/incarnation of \*\*(.+?)\*\*(?:\n|\.|,|$)/i);
      if (identityMatch) info.underlyingidentity = identityMatch[1].trim();
      
      return info;
    }

    function mdToHtml(text) {
      text = String(text || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      // First, handle the Canon Status Key section specially
      let html = text
        // Remove the Canon Status Key block entirely (it's metadata)
        .replace(/## Canon Status Key[\s\S]*?---\n*/i, '');
      
      // Remove the main title (h1) since we show it in the sidebar
      const nameMatch = html.match(/^#\s+(.+?)(?:\n|$)/m);
      if (nameMatch) {
        html = html.replace(/^#\s+.+?\n*/, '');
      }
      
      // Handle Canon status markers FIRST (before general bold)
      html = html
        .replace(/\*\*Confirmed:\*\*/g, '<span class="canon-confirmed">Confirmed:</span>')
        .replace(/\*\*Not yet established:\*\*/g, '<span class="canon-unconfirmed">Not yet established:</span>')
        .replace(/\*\*Possible:\*\*/g, '<span class="canon-possible">Possible:</span>')
        .replace(/\*\*Requires manuscript verification:\*\*/g, '<span class="canon-verify">Requires manuscript verification:</span>');
      
      // Now handle remaining Markdown
      html = html
        // Headers - order matters (longest first), make content optional (.* not .+)
        .replace(/^####\s*(.*)$/gim, '<h4>$1</h4>')
        .replace(/^###\s*(.*)$/gim, '<h3>$1</h3>')
        .replace(/^##\s*(.*)$/gim, '<h2>$1</h2>')
        // Remove empty h1/h4 tags that are just decorative
        .replace(/<h[14]><\/h[14]>/g, '')
        // Bold/italic (won't match the canon markers anymore)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // MD links [text](url)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+|\/[^)]*)\)/g, '<a href="$2">$1</a>')
        // Horizontal rules
        .replace(/^---$/gim, '<hr>')
        // Lists
        .replace(/^-\s+(.+)$/gim, '<li>$1</li>');
      
      // Wrap list items in ul
      html = html.replace(/(<li>.*<\/li>\n*)+/gs, match => `<ul>${match}</ul>`);
      
      // Paragraphs - but preserve existing HTML tags
      html = html
        .replace(/\n\n+/g, '</p><p>')
        .replace(/^(?!<[hlu])/gim, '<p>')
        .replace(/$(?!<\/)/gim, '</p>');
      
      // Clean up empty paragraphs and multiple newlines
      html = html.replace(/<p><\/p>/g, '');
      html = html.replace(/\n/g, ' ');
      
      return html;
    }

    // Entity slugs that share their content with an incarnation's DB record
    const CHARACTER_ALIASES = {
      'admin-creation': 'tama',
      'admin-destruction': 'saki',
      'moderator-time': 'anna'
    };

    async function loadCharacter() {
      const urlKey = getCharName();
      const charKey = CHARACTER_ALIASES[urlKey] || urlKey;

      try {
        const response = await fetch(`/api/characters/${charKey}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const char = await response.json();
        
        const md = char.content;
        const name = char.name;
        
        // Extract info from content
        const info = extractInfoFromContent(md);
        
        // Update sidebar
        const avatarEl = document.getElementById('char-avatar');
        avatarEl.textContent = '';
        if (char.image) {
          const img = document.createElement('img');
          img.src = /^(\/|https?:\/\/)/i.test(char.image) ? char.image : '';
          img.alt = name;
          avatarEl.appendChild(img);
        } else {
          avatarEl.textContent = char.emoji;
        }
        document.getElementById('card-name').textContent = name;
        
        // Set role/type
        let roleText = char.char_type;
        if (info.underlyingidentity) {
          roleText = `${char.char_type} of ${info.underlyingidentity}`;
        } else if (info.role) {
          roleText = info.role;
        }
        document.getElementById('card-role').textContent = roleText;
        document.title = `${name} - Xanrean Chronicles`;

        // Back-link now always returns to the unified cast page
        const backLink = document.getElementById('back-link');
        backLink.href = '/xanrean/characters';
        backLink.textContent = '← Back to The Cast';
        
        // Build stats
        const stats = [];
        if (info.age) stats.push({label: 'Age', value: info.age});
        if (info.species || char.species) stats.push({label: 'Species', value: info.species || char.species});
        
        // Elements (without "Level")
        if (info.primaryelement || info.secondaryelement) {
          const primary = info.primaryelement || 'None';
          const secondary = info.secondaryelement || 'None';
          if (secondary !== 'None' && secondary !== 'None currently established' && secondary !== '') {
            stats.push({label: 'Elements', value: `${primary} / ${secondary}`});
          } else {
            stats.push({label: 'Element', value: primary});
          }
        }
        
        const statsHtml = stats.map(s => 
           `<div class="char-stat"><span class="char-stat-label">${escapeHtml(s.label)}</span><span>${escapeHtml(s.value)}</span></div>`
        ).join('');
        document.getElementById('card-stats').innerHTML = statsHtml;
        
        // Split and render content
        const sections = md.split(/##\s+/);
        
        let contentHtml = '';
        
        // Process each section
        for (let i = 0; i < sections.length; i++) {
          if (!sections[i].trim()) continue;
          
          const lines = sections[i].split('\n');
          const firstLine = lines[0].trim();
          
          // Skip if this is just the title (starts with #)
          if (firstLine.startsWith('# ')) {
            const body = sections[i].replace(/^#\s+.+\n?/, '').trim();
            if (body) {
              contentHtml += `<div class="char-section">${mdToHtml(body)}</div>`;
            }
            continue;
          }
          
          // Regular section with header
          const title = firstLine;
          const body = lines.slice(1).join('\n').trim();
          
          if (body) {
            contentHtml += `
              <div class="char-section">
                 <h3>${escapeHtml(title)}</h3>
                ${mdToHtml(body)}
              </div>
            `;
          }
        }
        
        // Relationships Section
        if (char.relationships && char.relationships.length > 0) {
          const relsHtml = char.relationships.map(r => `
            <div class="rel-card">
               <a href="/xanrean/characters/${encodeURIComponent(r.character_slug || '')}" class="rel-name">${escapeHtml(r.character_name || r.character_slug)}</a>
               <span class="rel-type">${escapeHtml(r.relationship_type)}</span>
               <div class="rel-desc">${escapeHtml(r.description)}</div>
            </div>
          `).join('');
          contentHtml += `
            <div class="rel-section">
              <h3>Relationships</h3>
              <div class="rel-grid">${relsHtml}</div>
            </div>
          `;
        }

        document.getElementById('char-content').innerHTML = contentHtml;
        
      } catch (err) {
        console.error('Failed to load:', err);
        document.getElementById('char-content').innerHTML = 
          `<div class="char-error">Failed to load character data.<br><br>Error: ${err.message}</div>`;
        document.getElementById('card-name').textContent = 'Error';
        document.getElementById('card-role').textContent = 'Failed to load';
        document.getElementById('char-avatar').textContent = '❌';
      }
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }


    loadCharacter();
  
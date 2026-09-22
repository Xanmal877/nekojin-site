/* Behaviour for xanrean/lore/world-topic.html — moved out of the markup verbatim. */
  function parseMarkdown(md) {
    if (!md) return '';
    md = String(md).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let html = md
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h2>$1</h2>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^- (.*)$/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
    html = html.split('\n\n').map(block => {
      if (block.startsWith('<h2') || block.startsWith('<ul')) return block;
      return `<p>${block.trim()}</p>`;
    }).join('\n');
    return html;
  }

  async function loadTopic() {
    const slug = window.location.pathname.split('/').pop();
    const container = document.getElementById('topic-content');

    try {
      const response = await fetch(`/api/lore-topics/${encodeURIComponent(slug)}`);
      if (!response.ok) throw new Error('Not found');
      const topic = await response.json();

      document.title = topic.title + ' - The Lore | Xanrean Chronicles';
      container.innerHTML = `<h1>${escapeHtml(topic.title)}</h1>${parseMarkdown(topic.content)}`;
    } catch (err) {
      container.innerHTML = '<div class="loading">Could not load this world topic.</div>';
    }
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  loadTopic();

/**
 * nekojin-chat-providers.js
 * Unified provider interface for Claude, OpenAI, xAI (Grok), Ollama, and pi Agent.
 * All external providers proxy through /api/proxy/chat for CORS + auth.
 */

const PROVIDERS = {
  pi: {
    id: 'pi',
    name: 'pi Agent',
    description: 'Local coding agent with tools & file access',
    useWebSocket: true,
    logo: 'PI',
    color: '#8b5cf6',
    models: [], // populated dynamically from server
    defaultModel: 'default'
  },

  claude: {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic',
    logo: 'C',
    color: '#d97757',
    requiresKey: true,
    keyName: 'Claude API Key',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', vision: true },
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4.6', vision: true },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', vision: true },
      { id: 'custom', name: 'Custom model…', custom: true }
    ],
    defaultModel: 'claude-sonnet-4-20250514',
    maxTokensDefault: 4096,
    supportsSystem: true,
    supportsTemperature: true
  },

  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT / ChatGPT',
    logo: 'O',
    color: '#10a37f',
    requiresKey: true,
    keyName: 'OpenAI API Key',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4.1', name: 'GPT-4.1', vision: true },
      { id: 'gpt-4o', name: 'GPT-4o', vision: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', vision: true },
      { id: 'o4-mini', name: 'o4 Mini', vision: false },
      { id: 'custom', name: 'Custom model…', custom: true }
    ],
    defaultModel: 'gpt-4.1',
    maxTokensDefault: 4096,
    supportsSystem: true,
    supportsTemperature: true
  },

  xai: {
    id: 'xai',
    name: 'Grok',
    description: 'xAI',
    logo: 'G',
    color: '#ef4444',
    requiresKey: true,
    keyName: 'xAI API Key',
    keyUrl: 'https://console.x.ai/',
    models: [
      { id: 'grok-4', name: 'Grok 4', vision: true },
      { id: 'grok-3', name: 'Grok 3', vision: true },
      { id: 'grok-3-fast', name: 'Grok 3 Fast', vision: true },
      { id: 'grok-2-vision', name: 'Grok 2 Vision', vision: true },
      { id: 'custom', name: 'Custom model…', custom: true }
    ],
    defaultModel: 'grok-4',
    maxTokensDefault: 4096,
    supportsSystem: true,
    supportsTemperature: true
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local desktop models',
    logo: '🦙',
    color: '#f59e0b',
    requiresKey: false,
    keyName: null,
    keyUrl: null,
    models: [], // populated dynamically
    defaultModel: '',
    maxTokensDefault: 4096,
    supportsSystem: true,
    supportsTemperature: true,
    needsBaseUrl: true,
    baseUrlDefault: 'http://192.168.1.23:11434'
  }
};

function getStoredKey(providerId) {
  try { return localStorage.getItem(`nekojin:apikey:${providerId}`) || ''; } catch { return ''; }
}
function setStoredKey(providerId, key) {
  try { localStorage.setItem(`nekojin:apikey:${providerId}`, key || ''); } catch {}
}
function getStoredBaseUrl() {
  try { return localStorage.getItem(`nekojin:ollama:url`) || PROVIDERS.ollama.baseUrlDefault; } catch { return PROVIDERS.ollama.baseUrlDefault; }
}
function setStoredBaseUrl(url) {
  try { localStorage.setItem(`nekojin:ollama:url`, url || PROVIDERS.ollama.baseUrlDefault); } catch {}
}

function getProviderDefaultModel(providerId) {
  const p = PROVIDERS[providerId];
  if (!p) return '';
  if (providerId === 'ollama') return localStorage.getItem('nekojin:ollama:lastModel') || '';
  return localStorage.getItem(`nekojin:model:${providerId}`) || p.defaultModel;
}
function setProviderDefaultModel(providerId, modelId) {
  try { localStorage.setItem(`nekojin:model:${providerId}`, modelId); } catch {}
}

// ── Ollama model fetch ──────────────────────────────────
async function fetchOllamaModels(baseUrl) {
  try {
    const url = (baseUrl || getStoredBaseUrl()).replace(/\/$/, '') + '/api/tags';
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map(m => ({
      id: m.name,
      name: m.name,
      vision: false // ollama vision depends on model, assume false
    }));
  } catch {
    return [];
  }
}

// ── Proxy chat endpoint ─────────────────────────────────
const PROXY_URL = `${location.protocol}//${location.host}/api/proxy/chat`;

async function* proxyChatStream(provider, model, messages, systemPrompt, options = {}, signal) {
  const body = {
    provider,
    model,
    messages,
    system: systemPrompt || undefined,
    stream: true,
    temperature: options.temperature ?? 0.7,
    topP: options.topP ?? 1,
    maxTokens: options.maxTokens ?? 4096
  };

  if (provider === 'ollama') {
    body.baseUrl = getStoredBaseUrl();
  } else {
    body.apiKey = getStoredKey(provider);
  }

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    let err = 'Proxy error';
    try { const d = await res.json(); err = d.error || err; } catch {}
    throw new Error(err + ` (${res.status})`);
  }

  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.type === 'error') throw new Error(chunk.error || 'Provider error');
          yield chunk;
        } catch (e) {
          if (e.message && e.message.includes('Provider error')) throw e;
          // Skip malformed lines
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ── Direct Ollama chat (browser → desktop Ollama) ─────
async function* ollamaChatStream(model, messages, systemPrompt, options = {}, signal) {
  const baseUrl = getStoredBaseUrl().replace(/\/$/, '');
  const url = baseUrl + '/api/chat';
  const msgs = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  for (const m of messages) {
    if (m.role === 'system') continue;
    msgs.push({ role: m.role, content: m.content });
  }
  const body = JSON.stringify({
    model,
    messages: msgs,
    stream: true,
    options: {
      temperature: options.temperature ?? 0.7,
      top_p: options.topP ?? 1,
      num_predict: options.maxTokens ?? 4096
    }
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal
  });
  if (!res.ok) {
    let err = 'Ollama error';
    try { const d = await res.json(); err = d.error || err; } catch {}
    throw new Error(err + ` (${res.status})`);
  }
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const data = JSON.parse(line);
          if (data.error) throw new Error(data.error);
          if (data.message?.content) {
            yield { type: 'text', text: data.message.content };
          }
          if (data.done) {
            if (data.eval_count != null) {
              yield { type: 'usage', input_tokens: data.prompt_eval_count || 0, output_tokens: data.eval_count || 0 };
            }
            yield { type: 'done' };
          }
        } catch (e) {
          if (e.message && !e.message.includes('Unexpected token')) throw e;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ── Format helpers ──────────────────────────────────────
function formatMarkdown(text) {
  let h = escapeHtml(text);
  const codeBlocks = [];

  // Fenced code blocks with optional language
  h = h.replace(/```([\w+.]*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    const safeLang = escapeHtml(lang || '').trim();
    const displayLang = safeLang || 'text';
    codeBlocks.push(`<pre><div class="code-header"><span class="code-lang">${displayLang}</span><button class="copy-btn" onclick="__nccCopyCode(this)" title="Copy">Copy</button></div><code class="${safeLang ? 'language-' + safeLang : ''}">${escapeHtml(code)}</code></pre>`);
    return `__NCC_CB_${idx}__`;
  });

  // Inline code
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold / Italic
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Strikethrough
  h = h.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Links
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="msg-link">$1</a>');

  // Auto-link bare URLs
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="msg-link">$1</a>');

  // Headers
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Blockquote
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Bullet lists (simple)
  h = h.replace(/^(?:\*\s|\-\s|\+\s)(.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> in <ul>
  h = h.replace(/(<li>.*?<\/li>\n?)+/g, '<ul>$&</ul>');

  // Numbered lists (simple)
  h = h.replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>');

  // Paragraphs: split on double newline
  const parts = h.split(/\n\n+/);
  h = parts.map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<') && (trimmed.startsWith('<pre') || trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<blockquote'))) return trimmed;
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  // Restore code blocks
  h = h.replace(/__NCC_CB_(\d+)__/g, (m, idx) => codeBlocks[idx]);

  return h;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function __nccCopyCode(btn) {
  const pre = btn.closest('pre');
  const code = pre ? pre.querySelector('code') : null;
  const text = code ? code.textContent : '';
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1200);
  });
}

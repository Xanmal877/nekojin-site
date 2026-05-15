/**
 * pi Chat Widget - Injected on every Nekojin Interactive page
 * Connects to local pi instance via WebSocket (/chat)
 */
(function() {
  'use strict';
  if (document.getElementById('pi-chat-root')) return;

  const WS_URL = `ws://${location.host}/chat`;
  const MAX_RECONNECT = 3;

  let ws = null;
  let reconnectAttempts = 0;
  let isOpen = false;
  let isStreaming = false;
  let pendingUI = new Map(); // extension UI request id -> resolve function
  let messageIdCounter = 0;

  // ── STYLES ────────────────────────────────────────────
  const styles = document.createElement('style');
  styles.textContent = `
    #pi-chat-root {
      --chat-bg: #120b26;
      --chat-surface: #1a1135;
      --chat-surface2: #231547;
      --chat-border: rgba(124,40,212,0.25);
      --chat-accent: #7c28d4;
      --chat-accent2: #a855f7;
      --chat-text: #e9d5ff;
      --chat-muted: #9b7bc0;
      --chat-user-bg: linear-gradient(135deg, #5b1a9a, #3b1770);
      --chat-assistant-bg: #1e1640;
      --chat-tool-bg: rgba(124,40,212,0.12);
      --font-display: 'Darumadrop One', cursive;
      --font-body: 'Zen Kaku Gothic New', sans-serif;
      --font-mono: 'Space Mono', monospace;
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      z-index: 9999;
      font-family: var(--font-body);
    }

    .pi-chat-btn {
      width: 56px; height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #7c28d4, #5b1a9a);
      border: 1px solid rgba(168,85,247,0.4);
      color: #fff;
      font-size: 1.4rem;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 24px rgba(91,26,154,0.4);
      transition: transform 0.25s, box-shadow 0.25s;
    }
    .pi-chat-btn:hover {
      transform: translateY(-3px) scale(1.05);
      box-shadow: 0 8px 32px rgba(91,26,154,0.55);
    }
    .pi-chat-btn .badge {
      position: absolute;
      top: -2px; right: -2px;
      width: 18px; height: 18px;
      background: #ef4444;
      border-radius: 50%;
      font-size: 0.6rem;
      font-weight: 700;
      display: none; align-items: center; justify-content: center;
      border: 2px solid #120b26;
    }
    .pi-chat-btn .badge.visible { display: flex; }

    .pi-chat-panel {
      position: absolute;
      bottom: calc(100% + 1rem);
      right: 0;
      width: 380px;
      max-width: calc(100vw - 2rem);
      height: 520px;
      max-height: calc(100vh - 8rem);
      background: var(--chat-bg);
      border: 1px solid var(--chat-border);
      border-radius: 20px;
      display: flex; flex-direction: column;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
      opacity: 0; transform: translateY(12px) scale(0.96);
      pointer-events: none;
      transition: opacity 0.3s, transform 0.3s;
    }
    .pi-chat-panel.open {
      opacity: 1; transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .pi-chat-header {
      padding: 0.9rem 1.1rem;
      background: linear-gradient(135deg, rgba(91,26,154,0.35), rgba(59,106,204,0.2));
      border-bottom: 1px solid var(--chat-border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .pi-chat-header .title {
      font-family: var(--font-display);
      font-size: 1.05rem;
      color: var(--chat-text);
      display: flex; align-items: center; gap: 0.5rem;
    }
    .pi-chat-header .status {
      font-size: 0.62rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--chat-muted);
      display: flex; align-items: center; gap: 0.35rem;
    }
    .pi-chat-header .status-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #4ade80;
      box-shadow: 0 0 6px #4ade80;
      animation: pulse-green 2.5s ease-in-out infinite;
    }
    .pi-chat-header .status-dot.offline {
      background: #ef4444;
      box-shadow: none;
      animation: none;
    }
    .pi-chat-header .status-dot.busy {
      background: #f59e0b;
      box-shadow: 0 0 6px #f59e0b;
      animation: pulse-amber 1.2s ease-in-out infinite;
    }
    @keyframes pulse-green { 0%,100%{opacity:1} 50%{opacity:.6} }
    @keyframes pulse-amber { 0%,100%{opacity:1} 50%{opacity:.5} }

    .pi-chat-header .actions {
      display: flex; gap: 0.4rem;
    }
    .pi-chat-header .actions button {
      background: transparent; border: none; color: var(--chat-muted);
      font-size: 0.9rem; cursor: pointer; padding: 0.25rem;
      border-radius: 6px; transition: color 0.2s, background 0.2s;
    }
    .pi-chat-header .actions button:hover {
      color: var(--chat-text); background: rgba(255,255,255,0.06);
    }

    .pi-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex; flex-direction: column;
      gap: 0.75rem;
    }
    .pi-chat-messages::-webkit-scrollbar { width: 5px; }
    .pi-chat-messages::-webkit-scrollbar-thumb {
      background: rgba(124,40,212,0.3); border-radius: 10px;
    }

    .pi-msg {
      max-width: 88%;
      padding: 0.65rem 0.9rem;
      border-radius: 14px;
      font-size: 0.85rem;
      line-height: 1.55;
      word-wrap: break-word;
      animation: msg-in 0.3s ease both;
    }
    @keyframes msg-in { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }

    .pi-msg.user {
      align-self: flex-end;
      background: var(--chat-user-bg);
      color: #fff;
      border-bottom-right-radius: 4px;
      border: 1px solid rgba(168,85,247,0.25);
    }
    .pi-msg.assistant {
      align-self: flex-start;
      background: var(--chat-assistant-bg);
      color: var(--chat-text);
      border-bottom-left-radius: 4px;
      border: 1px solid var(--chat-border);
    }
    .pi-msg.tool {
      align-self: center;
      max-width: 95%;
      background: var(--chat-tool-bg);
      color: var(--chat-muted);
      border: 1px solid rgba(124,40,212,0.15);
      font-size: 0.72rem;
      font-family: var(--font-mono);
      padding: 0.4rem 0.7rem;
      border-radius: 8px;
    }
    .pi-msg.tool .tool-name {
      color: var(--chat-accent2); font-weight: 700;
    }
    .pi-msg.error {
      align-self: center;
      background: rgba(239,68,68,0.1);
      color: #fca5a5;
      border: 1px solid rgba(239,68,68,0.2);
      font-size: 0.78rem;
    }
    .pi-msg pre {
      background: rgba(0,0,0,0.25);
      padding: 0.5rem;
      border-radius: 8px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.78rem;
      margin-top: 0.4rem;
    }
    .pi-msg code {
      font-family: var(--font-mono);
      background: rgba(0,0,0,0.2);
      padding: 0.1rem 0.3rem;
      border-radius: 4px;
      font-size: 0.82em;
    }
    .pi-msg.assistant.streaming::after {
      content: '▋';
      animation: blink 1s step-end infinite;
      color: var(--chat-accent2);
      margin-left: 0.15rem;
    }
    @keyframes blink { 50% { opacity: 0; } }

    .pi-chat-input-area {
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--chat-border);
      display: flex; gap: 0.5rem;
      background: rgba(10,6,22,0.6);
    }
    .pi-chat-input {
      flex: 1;
      background: var(--chat-surface);
      border: 1px solid var(--chat-border);
      border-radius: 12px;
      padding: 0.55rem 0.85rem;
      color: var(--chat-text);
      font-family: inherit;
      font-size: 0.85rem;
      outline: none;
      resize: none;
      max-height: 120px;
      transition: border-color 0.2s;
    }
    .pi-chat-input:focus { border-color: var(--chat-accent2); }
    .pi-chat-input::placeholder { color: var(--chat-muted); }
    .pi-chat-send {
      width: 38px; height: 38px;
      border-radius: 12px;
      background: linear-gradient(135deg, #7c28d4, #5b1a9a);
      border: 1px solid rgba(168,85,247,0.35);
      color: #fff;
      font-size: 1rem;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
      flex-shrink: 0;
    }
    .pi-chat-send:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 16px rgba(91,26,154,0.4);
    }
    .pi-chat-send:disabled {
      opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none;
    }

    .pi-chat-welcome {
      text-align: center;
      color: var(--chat-muted);
      font-size: 0.8rem;
      padding: 1.5rem 1rem;
      line-height: 1.6;
    }
    .pi-chat-welcome strong {
      color: var(--chat-accent2); font-weight: 700;
    }

    .pi-chat-ui-dialog {
      position: absolute;
      inset: 0;
      background: rgba(8,6,18,0.85);
      backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
      z-index: 10;
    }
    .pi-chat-ui-box {
      background: var(--chat-surface);
      border: 1px solid var(--chat-border);
      border-radius: 16px;
      padding: 1.25rem;
      width: 100%;
      max-width: 320px;
    }
    .pi-chat-ui-box h4 {
      font-family: var(--font-display);
      font-size: 1rem;
      color: var(--chat-text);
      margin-bottom: 0.75rem;
    }
    .pi-chat-ui-box p {
      font-size: 0.82rem;
      color: var(--chat-muted);
      margin-bottom: 1rem;
      line-height: 1.5;
    }
    .pi-chat-ui-box .ui-options {
      display: flex; flex-direction: column; gap: 0.4rem;
      margin-bottom: 1rem;
    }
    .pi-chat-ui-box .ui-options button {
      background: var(--chat-surface2);
      border: 1px solid var(--chat-border);
      color: var(--chat-text);
      padding: 0.55rem 0.8rem;
      border-radius: 10px;
      cursor: pointer;
      font-size: 0.82rem;
      text-align: left;
      transition: background 0.2s, border-color 0.2s;
    }
    .pi-chat-ui-box .ui-options button:hover {
      background: rgba(124,40,212,0.15);
      border-color: rgba(168,85,247,0.4);
    }
    .pi-chat-ui-box .ui-input {
      width: 100%;
      background: var(--chat-bg);
      border: 1px solid var(--chat-border);
      border-radius: 10px;
      padding: 0.5rem 0.7rem;
      color: var(--chat-text);
      font-family: inherit;
      font-size: 0.85rem;
      margin-bottom: 0.75rem;
      outline: none;
    }
    .pi-chat-ui-box .ui-input:focus { border-color: var(--chat-accent2); }
    .pi-chat-ui-box .ui-actions {
      display: flex; gap: 0.5rem; justify-content: flex-end;
    }
    .pi-chat-ui-box .ui-actions button {
      padding: 0.45rem 1rem;
      border-radius: 10px;
      border: none;
      font-size: 0.82rem;
      cursor: pointer;
      font-weight: 600;
    }
    .pi-chat-ui-box .ui-actions .ui-ok {
      background: linear-gradient(135deg, #7c28d4, #5b1a9a);
      color: #fff;
    }
    .pi-chat-ui-box .ui-actions .ui-cancel {
      background: rgba(255,255,255,0.05);
      color: var(--chat-muted);
      border: 1px solid var(--chat-border);
    }

    @media (max-width: 480px) {
      #pi-chat-root {
        bottom: 1rem; right: 1rem;
      }
      .pi-chat-panel {
        width: calc(100vw - 2rem);
        height: calc(100vh - 7rem);
        max-height: none;
      }
    }
  `;
  document.head.appendChild(styles);

  // ── DOM ───────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'pi-chat-root';
  root.innerHTML = `
    <button class="pi-chat-btn" id="pi-chat-toggle" aria-label="Open pi chat">
      🤖<span class="badge" id="pi-chat-badge"></span>
    </button>
    <div class="pi-chat-panel" id="pi-chat-panel">
      <div class="pi-chat-header">
        <div>
          <div class="title">🐾 pi Assistant</div>
          <div class="status"><span class="status-dot offline" id="pi-status-dot"></span><span id="pi-status-text">Connecting…</span></div>
        </div>
        <div class="actions">
          <button id="pi-chat-settings" title="Settings">⚙</button>
          <button id="pi-chat-new" title="New session">✨</button>
          <button id="pi-chat-close" title="Close">✕</button>
        </div>
      </div>
      <div class="pi-chat-messages" id="pi-chat-messages">
        <div class="pi-chat-welcome">
          <strong>Welcome to pi</strong><br>
          Your local coding agent. Ask me anything. I can read files, run commands, edit code, and more.
        </div>
      </div>
      <div class="pi-chat-input-area">
        <textarea class="pi-chat-input" id="pi-chat-input" rows="1" placeholder="Ask pi…"></textarea>
        <button class="pi-chat-send" id="pi-chat-send">➤</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const toggleBtn = document.getElementById('pi-chat-toggle');
  const panel = document.getElementById('pi-chat-panel');
  const closeBtn = document.getElementById('pi-chat-close');
  const newBtn = document.getElementById('pi-chat-new');
  const settingsBtn = document.getElementById('pi-chat-settings');
  const messagesEl = document.getElementById('pi-chat-messages');
  const inputEl = document.getElementById('pi-chat-input');
  const sendBtn = document.getElementById('pi-chat-send');
  const statusDot = document.getElementById('pi-status-dot');
  const statusText = document.getElementById('pi-status-text');

  // ── UI helpers ────────────────────────────────────────
  function setStatus(state, text) {
    statusDot.className = 'status-dot ' + state;
    statusText.textContent = text;
  }

  function toggle(open) {
    isOpen = open !== undefined ? open : !panel.classList.contains('open');
    panel.classList.toggle('open', isOpen);
    if (isOpen) scrollToBottom();
  }
  toggleBtn.addEventListener('click', () => toggle(true));
  closeBtn.addEventListener('click', () => toggle(false));
  newBtn.addEventListener('click', () => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'new_session' }));
      clearMessages();
      addWelcome();
      if (currentAssistantEl) { if (currentAssistantEl._raf) cancelAnimationFrame(currentAssistantEl._raf); currentAssistantEl = null; }
      isStreaming = false;
    }
  });

  // ── Settings Dialog ─────────────────────────────────
  settingsBtn.addEventListener('click', () => {
    const dialog = document.createElement('div');
    dialog.className = 'pi-chat-ui-dialog';
    dialog.innerHTML = `
      <div class="pi-chat-ui-box" style="max-width:420px;width:90vw;">
        <h4>⚙️ Settings</h4>
        <p style="font-size:0.78rem;color:var(--chat-muted);margin-bottom:0.75rem;">System Prompt. Sent to the AI at the start of every new session.</p>
        <textarea class="ui-input" id="pi-system-prompt" rows="6" style="resize:vertical;min-height:120px;font-size:0.8rem;line-height:1.5;"
          placeholder="Enter a custom system prompt…"></textarea>
        <div class="ui-actions" style="margin-top:0.5rem;">
          <button class="ui-cancel" id="pi-prompt-reset">Reset</button>
          <button class="ui-cancel" id="pi-prompt-cancel">Cancel</button>
          <button class="ui-ok" id="pi-prompt-save">Save</button>
        </div>
      </div>
    `;
    panel.appendChild(dialog);

    const promptInput = dialog.querySelector('#pi-system-prompt');

    // Load current prompt
    fetch('/system-prompt')
      .then(r => r.json())
      .then(d => { promptInput.value = d.prompt || ''; })
      .catch(() => {});

    dialog.querySelector('#pi-prompt-save').addEventListener('click', () => {
      fetch('/system-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptInput.value })
      }).then(r => {
        if (r.ok) {
          const toast = document.createElement('div');
          toast.textContent = 'Saved! AI will restart with new instructions.';
          toast.style.cssText = 'position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);background:var(--chat-surface2);border:1px solid var(--chat-border);color:var(--chat-text);padding:0.5rem 1rem;border-radius:8px;font-size:0.8rem;z-index:99999;opacity:0;transition:opacity 0.3s;';
          document.body.appendChild(toast);
          requestAnimationFrame(() => toast.style.opacity = '1');
          setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
        }
        dialog.remove();
      }).catch(() => dialog.remove());
    });

    dialog.querySelector('#pi-prompt-cancel').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#pi-prompt-reset').addEventListener('click', () => {
      fetch('/system-prompt')
        .then(r => r.json())
        .then(d => { promptInput.value = d.defaultPrompt || d.prompt || ''; })
        .catch(() => {});
    });

    // Close on overlay click
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });
  });

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function clearMessages() {
    messagesEl.innerHTML = '';
    if (currentAssistantEl) { if (currentAssistantEl._raf) cancelAnimationFrame(currentAssistantEl._raf); currentAssistantEl = null; }
    isStreaming = false;
  }

  function addWelcome() {
    messagesEl.innerHTML = `
      <div class="pi-chat-welcome">
        <strong>New session started</strong><br>
        Ask me anything. I can read files, run commands, edit code, and more.
      </div>
    `;
  }

  function createMessage(role, html = '') {
    const id = 'msg-' + (++messageIdCounter);
    const el = document.createElement('div');
    el.className = 'pi-msg ' + role;
    el.id = id;
    if (html) el.innerHTML = html;
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  window.__piCopyCode = function(btn) {
    const code = btn.nextElementSibling?.textContent || '';
    navigator.clipboard.writeText(code).then(() => {
      btn.textContent = '✓';
      setTimeout(() => btn.textContent = '📋', 1500);
    });
  };

  function formatText(text) {
    let html = escapeHtml(text);
    const codeBlocks = [];
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre style="position:relative;"><button style="position:absolute;top:0.3rem;right:0.3rem;background:rgba(124,40,212,0.25);border:1px solid rgba(124,40,212,0.4);color:#e9d5ff;border-radius:6px;padding:0.15rem 0.4rem;font-size:0.7rem;cursor:pointer;" onclick="window.__piCopyCode(this)">📋</button><code>${code}</code></pre>`);
      return `__PI_CB_${idx}__`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#a855f7;text-decoration:underline;">$1</a>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/__PI_CB_(\d+)__/g, (match, idx) => codeBlocks[idx]);
    return html;
  }

  // ── WebSocket ─────────────────────────────────────────
  function connect() {
    if (reconnectAttempts >= MAX_RECONNECT) {
      setStatus('offline', 'Unavailable');
      return;
    }
    reconnectAttempts++;
    setStatus('offline', 'Connecting…');

    try {
      ws = new WebSocket(WS_URL);
    } catch(e) {
      setStatus('offline', 'Unavailable');
      return;
    }

    ws.onopen = () => {
      reconnectAttempts = 0;
      setStatus('online', 'Ready');
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        handleEvent(data);
      } catch(e) {
        console.warn('pi chat: bad JSON', ev.data);
      }
    };

    ws.onclose = () => {
      setStatus('offline', 'Disconnected');
      ws = null;
      if (reconnectAttempts < MAX_RECONNECT) {
        setTimeout(connect, 2000);
      } else {
        setStatus('offline', 'Unavailable');
      }
    };

    ws.onerror = () => {
      setStatus('offline', 'Error');
    };
  }
  connect();

  // ── Event handling ────────────────────────────────────
  let currentAssistantEl = null;

  function handleEvent(data) {
    switch (data.type) {
      case 'message_update': {
        const ev = data.assistantMessageEvent;
        if (!ev) return;
        if (ev.type === 'text_start') {
          currentAssistantEl = createMessage('assistant streaming');
          isStreaming = true;
          setStatus('busy', 'Thinking…');
        } else if (ev.type === 'text_delta') {
          if (!currentAssistantEl) currentAssistantEl = createMessage('assistant streaming');
          if (!currentAssistantEl._textBuffer) currentAssistantEl._textBuffer = '';
          currentAssistantEl._textBuffer += ev.delta;
          if (!currentAssistantEl._raf) {
            currentAssistantEl._raf = requestAnimationFrame(() => {
              if (currentAssistantEl) {
                currentAssistantEl.innerHTML = formatText(currentAssistantEl._textBuffer);
                currentAssistantEl._raf = null;
              }
              scrollToBottom();
            });
          }
        } else if (ev.type === 'text_end') {
          if (currentAssistantEl) {
            if (currentAssistantEl._raf) cancelAnimationFrame(currentAssistantEl._raf);
            currentAssistantEl.innerHTML = formatText(currentAssistantEl._textBuffer || '');
            currentAssistantEl.classList.remove('streaming');
            currentAssistantEl = null;
          }
          isStreaming = false;
          setStatus('online', 'Ready');
        } else if (ev.type === 'done' || ev.type === 'error') {
          if (currentAssistantEl) {
            if (currentAssistantEl._raf) cancelAnimationFrame(currentAssistantEl._raf);
            currentAssistantEl.innerHTML = formatText(currentAssistantEl._textBuffer || '');
            currentAssistantEl.classList.remove('streaming');
            currentAssistantEl = null;
          }
          isStreaming = false;
          setStatus('online', 'Ready');
        }
        break;
      }

      case 'agent_start': {
        setStatus('busy', 'Working…');
        break;
      }
      case 'agent_end': {
        isStreaming = false;
        setStatus('online', 'Ready');
        break;
      }

      case 'tool_execution_start': {
        const toolEl = createMessage('tool');
        toolEl.innerHTML = `<span class="tool-name">⚙️ ${escapeHtml(data.toolName)}</span> running…`;
        toolEl._toolId = data.toolCallId;
        break;
      }
      case 'tool_execution_end': {
        const toolEl = Array.from(messagesEl.children).find(el => el._toolId === data.toolCallId);
        if (toolEl) {
          const ok = !data.isError;
          toolEl.innerHTML = `<span class="tool-name">${ok ? '✅' : '❌'} ${escapeHtml(data.toolName)}</span> ${ok ? 'done' : 'error'}`;
        }
        break;
      }
      case 'extension_error': {
        createMessage('error', `Extension error: ${escapeHtml(data.error || 'unknown')}`);
        break;
      }

      case 'extension_ui_request': {
        handleExtensionUI(data);
        break;
      }

      case 'response': {
        if (!data.success && data.error) {
          createMessage('error', escapeHtml(data.error));
        }
        break;
      }
    }
  }

  function handleExtensionUI(req) {
    const { id, method } = req;
    const dialog = document.createElement('div');
    dialog.className = 'pi-chat-ui-dialog';

    let inner = '';
    if (method === 'confirm') {
      inner = `
        <div class="pi-chat-ui-box">
          <h4>${escapeHtml(req.title || 'Confirm')}</h4>
          <p>${escapeHtml(req.message || '')}</p>
          <div class="ui-actions">
            <button class="ui-cancel">Cancel</button>
            <button class="ui-ok">Confirm</button>
          </div>
        </div>
      `;
    } else if (method === 'select') {
      const opts = (req.options || []).map(o =>
        `<button data-value="${escapeHtml(o)}">${escapeHtml(o)}</button>`
      ).join('');
      inner = `
        <div class="pi-chat-ui-box">
          <h4>${escapeHtml(req.title || 'Select')}</h4>
          <div class="ui-options">${opts}</div>
          <div class="ui-actions">
            <button class="ui-cancel">Cancel</button>
          </div>
        </div>
      `;
    } else if (method === 'input') {
      inner = `
        <div class="pi-chat-ui-box">
          <h4>${escapeHtml(req.title || 'Input')}</h4>
          <input type="text" class="ui-input" placeholder="${escapeHtml(req.placeholder || '…')}">
          <div class="ui-actions">
            <button class="ui-cancel">Cancel</button>
            <button class="ui-ok">OK</button>
          </div>
        </div>
      `;
    } else if (method === 'editor') {
      inner = `
        <div class="pi-chat-ui-box">
          <h4>${escapeHtml(req.title || 'Edit')}</h4>
          <textarea class="ui-input" rows="4" style="resize:vertical;">${escapeHtml(req.prefill || '')}</textarea>
          <div class="ui-actions">
            <button class="ui-cancel">Cancel</button>
            <button class="ui-ok">OK</button>
          </div>
        </div>
      `;
    } else {
      // Fire-and-forget or unknown: auto-cancel after short delay
      setTimeout(() => sendUIResponse(id, { cancelled: true }), 50);
      return;
    }

    dialog.innerHTML = inner;
    panel.appendChild(dialog);

    function closeDialog(payload) {
      sendUIResponse(id, payload);
      dialog.remove();
    }

    const okBtn = dialog.querySelector('.ui-ok');
    const cancelBtn = dialog.querySelector('.ui-cancel');

    if (method === 'confirm') {
      if (okBtn) okBtn.addEventListener('click', () => closeDialog({ confirmed: true }));
      if (cancelBtn) cancelBtn.addEventListener('click', () => closeDialog({ confirmed: false }));
    } else if (method === 'select') {
      dialog.querySelectorAll('.ui-options button').forEach(btn => {
        btn.addEventListener('click', () => closeDialog({ value: btn.dataset.value }));
      });
      if (cancelBtn) cancelBtn.addEventListener('click', () => closeDialog({ cancelled: true }));
    } else if (method === 'input' || method === 'editor') {
      const field = dialog.querySelector('.ui-input');
      if (okBtn) okBtn.addEventListener('click', () => closeDialog({ value: field.value }));
      if (cancelBtn) cancelBtn.addEventListener('click', () => closeDialog({ cancelled: true }));
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && method === 'input') {
          e.preventDefault();
          closeDialog({ value: field.value });
        }
      });
    }

    // Auto-cancel if timeout specified (client-side safety)
    if (req.timeout && req.timeout > 0) {
      setTimeout(() => {
        if (dialog.parentNode) closeDialog({ cancelled: true });
      }, req.timeout + 500);
    }
  }

  function sendUIResponse(id, payload) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'extension_ui_response', id, ...payload }));
    }
  }

  // ── Input handling ──────────────────────────────────────
  function sendPrompt() {
    const text = inputEl.value.trim();
    if (!text) return;
    if (!ws || ws.readyState !== 1) {
      createMessage('error', 'Not connected to pi. Please wait or refresh.');
      return;
    }
    if (isStreaming) {
      // Queue as steer during streaming
      ws.send(JSON.stringify({ type: 'steer', message: text }));
    } else {
      ws.send(JSON.stringify({ type: 'prompt', message: text }));
    }
    createMessage('user', escapeHtml(text));
    inputEl.value = '';
    inputEl.rows = 1;
  }

  sendBtn.addEventListener('click', sendPrompt);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });
  inputEl.addEventListener('input', () => {
    inputEl.rows = Math.min(6, Math.max(1, inputEl.value.split('\n').length));
  });
})();

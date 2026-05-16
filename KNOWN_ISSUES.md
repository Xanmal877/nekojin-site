# AI Chat Overhaul — Known Issues / Next Steps

## Date: 2026-05-15
## Status: V1 shipped — core flows work, polish needed

---

### BUGS / INCOMPLETE

1. **Stop button during agent tool execution**
   The pi Agent can run tools after streaming text ends (`text_end`). The stop button is hidden on `text_end`, so users can't abort tool chains. Need to show stop button on `agent_start` and hide only on `agent_end`.

2. **Image uploads are display-only for external APIs**
   When you attach an image, it shows in the UI but the `sendApiMessage()` function does NOT encode and send it to Claude/OpenAI/Grok. Only the pi agent handles images via its existing upload flow.
   Fix: base64 encode images and send via multimodal API formats.

3. **Ollama model refresh**
   Ollama models are fetched once on page load if the provider is already ollama. If you switch to ollama later, models stay empty until reload. Need to fetch on provider switch.

4. **Custom model input not wired**
   providers with `custom: true` show in the model picker but selecting one does nothing. Need a prompt or input field for the user to type a model ID.

5. **No syntax highlighting**
   Code blocks have language labels and copy buttons, but no actual syntax highlighting. Prism.js or highlight.js could be added.

6. **Settings panel layout on mobile**
   Provider cards are a 2-column grid which may be cramped on very narrow screens. Tested on desktop only.

7. **AbortSignal.timeout compat**
   `fetchOllamaModels` uses `AbortSignal.timeout(5000)` which may not exist in older browser versions. Fallback needed.

8. **chat.js widget still has emojis**
   The floating pi chat widget (`public/chat.js`) was NOT updated. It still uses `🤖`, `🐾`, `⚙`, `✨`, `📋`, etc.

---

### NICE TO HAVE

- **Export conversation** as markdown or JSON
- **Message branching / edit-and-resend** (like Claude/GPT web UIs)
- **Per-conversation settings** (temperature, max tokens per chat instead of global)
- **Code execution indicator** while pi agent runs bash/code
- **Keyboard shortcuts** (Ctrl+N new chat, Ctrl+Shift+S settings)
- **Dark / light theme toggle** (currently dark-only)
- **Auto-scroll disable** when user scrolls up during streaming
- **Search conversations** in sidebar

---

### TESTED
- Server proxy endpoint `/api/proxy/chat` returns 401 for unauthenticated requests (correct)
- Server proxy handles `openai`, `claude`, `xai`, `ollama` providers with streaming NDJSON
- Client-side IndexedDB sessions persist across reloads
- Provider switching in settings works
- Stop button appears/hides during external provider streaming
- `aichat.html` loads without JS syntax errors

---

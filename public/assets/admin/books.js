/* Admin panel: books */
// ── RENDER: BOOKS PANEL ───────────────────────────────────
function renderBooksPanel() {
  const container = document.getElementById('books-editor');
  if (!siteContent) { container.innerHTML = '<p style="color:var(--red);">Content failed to load.</p>'; return; }

  let html = '';

  // Series
  (siteContent.series || []).forEach((series, si) => {
    const isFirst = si === 0;
    const isLast  = si === siteContent.series.length - 1;
    html += `
    <div class="card" id="series-card-${si}" style="margin-bottom:1.5rem;">
      <div class="series-header">
        <div class="series-header-title">📖 ${esc(series.universe) || '<em style="color:var(--muted)">Unnamed Series</em>'}</div>
        <div class="series-header-actions">
          <button class="btn-icon" title="Move up"   onclick="moveSeries(${si},-1)" ${isFirst?'disabled':''}>↑</button>
          <button class="btn-icon" title="Move down" onclick="moveSeries(${si}, 1)" ${isLast ?'disabled':''}>↓</button>
          <button class="btn-icon danger" title="Delete series" onclick="removeSeries(${si})">🗑</button>
        </div>
      </div>

      <label>Universe Name</label>
      <input type="text" value="${esc(series.universe)}"
        oninput="siteContent.series[${si}].universe=this.value; markDirty()">

      <label>Universe Description</label>
      <textarea oninput="siteContent.series[${si}].universeDesc=this.value; markDirty()">${esc(series.universeDesc)}</textarea>

      <label>Series Cover Image</label>
      <div class="cover-upload-area" onclick="triggerSeriesCoverUpload(${si})">
        ${series.cover_image
          ? `<img class="cover-preview" src="${esc(series.cover_image)}" id="series-cover-preview-${si}" alt="Series Cover">`
          : `<div style="font-size:2rem;margin-bottom:0.5rem;">🖼️</div>`
        }
        <div class="upload-hint">Click to upload a new cover image</div>
        <input type="file" accept="image/*" id="series-cover-input-${si}"
          onchange="handleSeriesCoverUpload(event,${si})">
      </div>
      <div style="margin-bottom:0.5rem;">
        <label>Cover URL (or leave blank)</label>
        <input type="text" value="${esc(series.cover_image||'')}" placeholder="/covers/series-cover.jpg"
          oninput="siteContent.series[${si}].cover_image=this.value; markDirty(); updateSeriesCoverPreview(${si},this.value)">
      </div>

      <div class="form-row">
        <div>
          <label>Series Status</label>
          <select onchange="siteContent.series[${si}].status=this.value; markDirty()">
            <option value="Planned" ${series.status === 'Planned' ? 'selected' : ''}>Planned</option>
            <option value="Ongoing" ${series.status === 'Ongoing' ? 'selected' : ''}>Ongoing</option>
            <option value="Complete" ${series.status === 'Complete' ? 'selected' : ''}>Complete</option>
          </select>
        </div>
        <div>
          <label>Reading Order</label>
          <input type="number" value="${esc(series.reading_order || 0)}"
            oninput="siteContent.series[${si}].reading_order=parseInt(this.value)||0; markDirty()">
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
        <div style="font-size:0.75rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);">Books (${series.books.length}) • ${series.totalWordCount?.toLocaleString() || 0} words</div>
        <button class="btn btn-ghost btn-sm" onclick="collapseAllBooks(${si})">Collapse All</button>
      </div>

      ${series.books.length === 0
        ? `<div class="empty-state"><div class="empty-state-icon">📭</div>No books yet. Use "Add Book" below.</div>`
        : series.books.map((book, bi) => renderBookEditor(si, bi, book, series.books.length)).join('')
      }
    </div>`;
  });

  // Standalone books
  const standalone = siteContent.books || [];
  html += `
  <div class="card" style="margin-bottom:1.5rem;">
    <div class="standalone-header">
      <span>📎 Standalone Books (${standalone.length})</span>
    </div>
    ${standalone.length === 0
      ? `<div class="empty-state"><div class="empty-state-icon">📭</div>No standalone books. Use "Add Standalone Book" below.</div>`
      : standalone.map((book, bi) => renderBookEditor(-1, bi, book, standalone.length)).join('')
    }
  </div>`;

  container.innerHTML = html;
}

function platBadges(platforms) {
  if (!platforms || !platforms.length) return '';
  return platforms.map(p => `<span class="platform-badge ${p.type||'other'}">${p.type==='rr'?'RR':p.type==='sh'?'SH':p.type==='kdp'?'KDP':(p.type||'?').toUpperCase()}</span>`).join('');
}

function renderBookEditor(si, bi, book, totalBooks) {
  const isFirst = bi === 0;
  const isLast  = bi === totalBooks - 1;
  const editorId = `be-${si}-${bi}`;
  const visBadge = book.visible === false
    ? `<span class="vis-badge hidden">Hidden</span>`
    : `<span class="vis-badge">Visible</span>`;
  return `
  <div class="book-editor" id="${editorId}" draggable="true"
    ondragstart="dragStart(event,${si},${bi})"
    ondragover="dragOver(event)"
    ondragenter="dragEnter(event)"
    ondragleave="dragLeave(event)"
    ondrop="dragDrop(event,${si},${bi})">
    <div class="book-editor-header">
      <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
      <div class="book-editor-toggle" onclick="toggleBookEditor('${editorId}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleBookEditor('${editorId}')}">
        <span class="chevron">▼</span>
        <div style="min-width:0;">
          <div class="book-editor-title">${esc(book.title)||'Untitled'} <small style="color:var(--muted);font-size:0.75rem;">${esc(book.volume||'')}</small></div>
          <div class="book-card-meta">${platBadges(book.platforms)}${visBadge}</div>
        </div>
      </div>
      <div class="book-editor-actions">
        <button class="btn-icon" title="Move up"   onclick="moveBook(${si},${bi},-1)" ${isFirst?'disabled':''}>↑</button>
        <button class="btn-icon" title="Move down" onclick="moveBook(${si},${bi}, 1)" ${isLast ?'disabled':''}>↓</button>
        <button class="btn-icon danger" title="Delete book" onclick="removeBook(${si},${bi})">🗑</button>
      </div>
    </div>
    <div class="book-editor-body">
      <div class="form-row">
        <div>
          <label>Title</label>
          <input type="text" value="${esc(book.title)}"
            oninput="getBook(${si},${bi}).title=this.value; markDirty()">
        </div>
        <div>
          <label>Volume Label</label>
          <input type="text" value="${esc(book.volume||'')}"
            oninput="getBook(${si},${bi}).volume=this.value; markDirty()">
        </div>
        <div>
          <label>Xanrean Tier</label>
          <select onchange="getBook(${si},${bi}).tier=this.value; markDirty()">
            <option value="" ${!book.tier ? 'selected' : ''}>None</option>
            <option value="admins" ${book.tier==='admins' ? 'selected' : ''}>👑 The Admins</option>
            <option value="moderators" ${book.tier==='moderators' ? 'selected' : ''}>🛡️ The Moderators</option>
          </select>
        </div>
      </div>

      <div class="form-row">
        <div>
          <label>Status</label>
          <select onchange="getBook(${si},${bi}).status=this.value; markDirty()">
            <option value="draft" ${book.status==='draft' ? 'selected' : ''}>Draft</option>
            <option value="preview" ${book.status==='preview' ? 'selected' : ''}>Preview</option>
            <option value="published" ${book.status==='published' || book.status==='released' ? 'selected' : ''}>Published</option>
            <option value="archived" ${book.status==='archived' ? 'selected' : ''}>Archived</option>
          </select>
        </div>
        <div style="flex:2">
          <label>Publish At <span style="font-size:0.7rem;color:var(--muted);font-weight:400;">(leave blank for immediate)</span></label>
          <input type="datetime-local" value="${esc(toDatetimeLocal(book.publishAt || book.publish_at))}"
            onchange="getBook(${si},${bi}).publishAt = this.value ? new Date(this.value).toISOString() : null; markDirty()">
        </div>
      </div>

      <div class="form-row">
        <div style="flex:2">
          <label>Slug <span style="font-size:0.7rem;color:var(--muted);font-weight:400;">short ID for URLs &amp; manuscript filename</span></label>
          <input type="text" value="${esc(book.slug||book.id||'')}"
            oninput="getBook(${si},${bi}).slug=this.value; markDirty()"
            placeholder="nekojin, her-majesty, lucas...">
        </div>
        <div style="flex:1">
          <label>Book ID <span style="font-size:0.7rem;color:var(--muted);font-weight:400;">read-only</span></label>
          <input type="text" value="${esc(book.id||'')}" readonly style="opacity:0.6;cursor:not-allowed;"
            title="Auto-generated. The slug is what you use for filenames.">
        </div>
      </div>

      <label>Blurb <span style="font-size:0.7rem;color:var(--muted);font-weight:400;">short hook for cards</span></label>
      <textarea oninput="getBook(${si},${bi}).blurb=this.value; markDirty()" rows="2">${esc(book.blurb || '')}</textarea>

      <label>Description</label>
      <textarea oninput="getBook(${si},${bi}).description=this.value; markDirty()">${esc(book.description)}</textarea>

      <label>Tags (comma-separated)</label>
      <input type="text" value="${esc(book.tags ? book.tags.join(', ') : '')}"
        oninput="getBook(${si},${bi}).tags=this.value.split(',').map(t=>t.trim()).filter(Boolean); markDirty()">

      <label>Cover Image</label>
      <div class="cover-upload-area" onclick="triggerCoverUpload(${si},${bi})">
        ${book.cover
          ? `<img class="cover-preview" src="${esc(book.cover)}" id="cover-preview-${si}-${bi}" alt="Cover">`
          : `<div style="font-size:2rem;margin-bottom:0.5rem;">🖼️</div>`
        }
        <div class="upload-hint">Click to upload a new cover image</div>
        <input type="file" accept="image/*" id="cover-input-${si}-${bi}"
          onchange="handleCoverUpload(event,${si},${bi})">
      </div>
      <div style="margin-bottom:0.5rem;">
        <label>Cover URL (or leave blank)</label>
        <input type="text" value="${esc(book.cover||'')}" placeholder="/covers/my-cover.jpg"
          oninput="getBook(${si},${bi}).cover=this.value; markDirty(); updateCoverPreview(${si},${bi},this.value)">
      </div>

      <label>Platform Links</label>
      <div id="platforms-${si}-${bi}">
        ${renderPlatformRows(book.platforms, si, bi)}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="addPlatform(${si},${bi})">+ Add Platform</button>

      <div style="margin-top:1rem;">
        <label style="font-size:0.78rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">Primary CTA Platform</label>
        <select style="width:100%;padding:0.5rem 0.7rem;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:0.85rem;margin-top:0.4rem;"
          onchange="getBook(${si},${bi}).ctaPlatform=this.value; markDirty()">
          <option value="kdp" ${(book.ctaPlatform||'kdp')==='kdp'?'selected':''}>Kindle (KDP)</option>
          <option value="gumroad" ${book.ctaPlatform==='gumroad'?'selected':''}>Gumroad</option>
          <option value="rr"  ${book.ctaPlatform==='rr'?'selected':''}>Royal Road</option>
          <option value="sh"  ${book.ctaPlatform==='sh'?'selected':''}>ScribbleHub</option>
          <option value="other" ${book.ctaPlatform==='other'?'selected':''}>Other</option>
        </select>
        <div style="font-size:0.75rem;color:var(--muted);margin-top:0.3rem;">Which platform the reader CTA links to by default.</div>
      </div>

      <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
          <div style="font-size:0.78rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">📖 Manuscript</div>
          <span id="ms-status-${si}-${bi}" style="font-size:0.75rem;color:var(--muted);"></span>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <input type="file" id="ms-input-${si}-${bi}" accept=".docx" style="display:none"
            onchange="handleBookMsUpload(event,${si},${bi})">
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('ms-input-${si}-${bi}').click()">📄 Upload .docx</button>
          <a href="/read?book=${encodeURIComponent(book.slug || book.id)}" target="_blank" class="btn btn-ghost btn-sm" id="ms-read-btn-${si}-${bi}" style="display:none;">Open Reader →</a>
        </div>
        <div style="font-size:0.75rem;color:var(--muted);margin-top:0.5rem;">
          File will be saved as <strong style="color:var(--text);">${esc(book.slug || book.id)}.docx</strong>. Use Heading 1 for chapter titles.
        </div>
      </div>
    </div>
  </div>`;
}

function toggleBookEditor(editorId) {
  document.getElementById(editorId)?.classList.toggle('open');
}

function collapseAllBooks(si) {
  const prefix = `be-${si}-`;
  document.querySelectorAll(`[id^="${prefix}"]`).forEach(el => el.classList.remove('open'));
}

// ── PLATFORM ROWS ─────────────────────────────────────────
function renderPlatformRows(platforms, si, bi) {
  if (!platforms || !platforms.length) return '';
  return platforms.map((p, pi) => `
    <div class="platform-row" id="pr-${si}-${bi}-${pi}">
      <select onchange="getBook(${si},${bi}).platforms[${pi}].type=this.value; markDirty()">
        <option value="rr"    ${p.type==='rr'   ?'selected':''}>Royal Road</option>
        <option value="sh"    ${p.type==='sh'   ?'selected':''}>ScribbleHub</option>
        <option value="kdp"   ${p.type==='kdp'  ?'selected':''}>Kindle (KDP)</option>
        <option value="gumroad" ${p.type==='gumroad'?'selected':''}>Gumroad</option>
        <option value="other" ${p.type==='other'?'selected':''}>Other</option>
      </select>
      <input type="url" value="${esc(p.url)}" placeholder="https://..."
        oninput="getBook(${si},${bi}).platforms[${pi}].url=this.value; markDirty()">
      <button class="btn btn-danger btn-sm" onclick="removePlatform(${si},${bi},${pi})">✕</button>
    </div>
  `).join('');
}

function addPlatform(si, bi) {
  getBook(si, bi).platforms.push({ type: 'rr', name: 'Royal Road', url: '' });
  markDirty();
  document.getElementById(`platforms-${si}-${bi}`).innerHTML =
    renderPlatformRows(getBook(si, bi).platforms, si, bi);
}

function removePlatform(si, bi, pi) {
  getBook(si, bi).platforms.splice(pi, 1);
  markDirty();
  document.getElementById(`platforms-${si}-${bi}`).innerHTML =
    renderPlatformRows(getBook(si, bi).platforms, si, bi);
}

// ── COVER UPLOAD ──────────────────────────────────────────
function triggerCoverUpload(si, bi) {
  document.getElementById(`cover-input-${si}-${bi}`).click();
}

function triggerSeriesCoverUpload(si) {
  document.getElementById(`series-cover-input-${si}`).click();
}

async function handleCoverUpload(event, si, bi) {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('cover', file);
  form.append('bookId', getBook(si, bi).id);
  try {
    const res  = await fetch('/upload-cover', { method: 'POST', headers: { 'X-CSRF-Token': getCsrfToken() }, body: form });
    const data = await res.json();
    getBook(si, bi).cover = data.path;
    markDirty();
    const preview = document.getElementById(`cover-preview-${si}-${bi}`);
    if (preview) preview.src = data.path;
    showToast('Cover uploaded!');
  } catch(e) {
    showToast('Upload failed', 'error');
  }
}

async function handleSeriesCoverUpload(event, si) {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('cover', file);
  form.append('bookId', siteContent.series[si].id);
  try {
    const res = await fetch('/upload-cover', { method: 'POST', headers: { 'X-CSRF-Token': getCsrfToken() }, body: form });
    const data = await res.json();
    siteContent.series[si].cover_image = data.path;
    markDirty();
    const preview = document.getElementById(`series-cover-preview-${si}`);
    if (preview) preview.src = data.path;
    showToast('Series cover uploaded!');
  } catch(e) {
    showToast('Upload failed', 'error');
  }
}

function updateCoverPreview(si, bi, url) {
  const el = document.getElementById(`cover-preview-${si}-${bi}`);
  if (el) el.src = url;
}

function updateSeriesCoverPreview(si, url) {
  const el = document.getElementById(`series-cover-preview-${si}`);
  if (el) el.src = url;
}

// ── ADD SERIES / BOOKS ────────────────────────────────────
async function openAddSeriesModal() {
  const name = await promptModal('New series name', 'e.g. Xanrean Chronicles', '', 'Create Series');
  if (!name) return;
  siteContent.series.push({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    visible: true, universe: name, universeDesc: '', books: [],
  });
  markDirty();
  renderBooksPanel();
  renderVisibilityPanel();
  showToast('Series created.');
}

async function openAddBookModal() {
  if (!siteContent.series.length && !(siteContent.books || []).length) {
    showToast('Create a series first, or use Add Standalone Book.', 'error'); return;
  }
  const idx = await openSeriesPickerModal();
  if (idx === null) return;
  if (idx === -1) {
    addStandaloneBook();
  } else {
    siteContent.series[idx].books.push(newBook());
    markDirty();
    renderBooksPanel();
    renderVisibilityPanel();
    showToast('Book added.');
  }
}

function addStandaloneBook() {
  if (!Array.isArray(siteContent.books)) siteContent.books = [];
  siteContent.books.push(newBook());
  markDirty();
  renderBooksPanel();
  renderVisibilityPanel();
  showToast('Standalone book added.');
}

// ── REMOVE SERIES / BOOKS ─────────────────────────────────
async function removeSeries(si) {
  const s = siteContent.series[si];
  const bookCount = s.books.length;
  const ok = await confirmModal(
    `Delete "${s.universe}"?`,
    bookCount > 0
      ? `This will permanently delete the series and all ${bookCount} book(s) inside it.`
      : 'This will permanently delete the empty series.'
  );
  if (!ok) return;
  siteContent.series.splice(si, 1);
  markDirty();
  renderBooksPanel();
  renderVisibilityPanel();
  showToast('Series deleted.');
}

async function removeBook(si, bi) {
  const book = getBook(si, bi);
  const ok = await confirmModal(`Delete "${book.title}"?`, 'This book will be permanently removed.');
  if (!ok) return;
  getBooks(si).splice(bi, 1);
  markDirty();
  renderBooksPanel();
  renderVisibilityPanel();
  showToast('Book deleted.');
}

// ── REORDER ───────────────────────────────────────────────
function moveSeries(si, dir) {
  const arr = siteContent.series;
  const ni  = si + dir;
  if (ni < 0 || ni >= arr.length) return;
  [arr[si], arr[ni]] = [arr[ni], arr[si]];
  markDirty();
  renderBooksPanel();
  renderVisibilityPanel();
}

function moveBook(si, bi, dir) {
  const arr = getBooks(si);
  const ni  = bi + dir;
  if (ni < 0 || ni >= arr.length) return;
  [arr[bi], arr[ni]] = [arr[ni], arr[bi]];
  markDirty();
  renderBooksPanel();
  renderVisibilityPanel();
}


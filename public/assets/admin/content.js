/* Admin panel: content */
// ── RENDER: ABOUT ─────────────────────────────────────────
function renderAboutPanel() {
  if (!siteContent?.about) return;
  const a = siteContent.about;
  document.getElementById('about-editor').innerHTML = `
    <div class="card-title">🏛️ Studio Info</div>
    <label>Studio Name</label>
    <input type="text" value="${esc(a.studioName)}" oninput="siteContent.about.studioName=this.value; markDirty()">
    <label>Footer Tagline</label>
    <input type="text" value="${esc(a.tagline)}" oninput="siteContent.about.tagline=this.value; markDirty()">

    <div style="margin:1rem 0;padding:1rem;background:var(--surface2);border-radius:10px;border:1px solid var(--border);">
      <label style="margin-bottom:0.5rem;display:block;">Studio Portrait Image</label>
      <div style="display:flex;gap:1rem;align-items:flex-start;flex-wrap:wrap;">
        <div style="width:120px;height:160px;border-radius:12px;background:var(--surface);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;"
             id="about-portrait-preview">
          ${a.portrait ? `<img src="${esc(a.portrait)}" style="width:100%;height:100%;object-fit:cover;">` : '<span style="font-size:3rem;">🏢</span>'}
        </div>
        <div style="flex:1;min-width:200px;">
          <input type="text" id="about-portrait-input" value="${esc(a.portrait||'')}" placeholder="/images/portrait.png"
                 oninput="siteContent.about.portrait=this.value; markDirty(); updateAboutPortraitPreview(this.value);"
                 style="margin-bottom:0.5rem;">
          <div style="display:flex;gap:0.5rem;">
            <input type="file" id="about-portrait-file" accept="image/*" style="display:none;"
                   onchange="handlePortraitUpload(this)">
            <button class="btn btn-ghost" onclick="document.getElementById('about-portrait-file').click()" style="font-size:0.85rem;">📁 Upload Image</button>
            <button class="btn btn-ghost" onclick="siteContent.about.portrait=''; document.getElementById('about-portrait-input').value=''; updateAboutPortraitPreview(''); markDirty();" style="font-size:0.85rem;" ${a.portrait?'':'disabled'}>Clear</button>
          </div>
          <p style="font-size:0.75rem;color:var(--muted);margin-top:0.5rem;">Upload a portrait or logo image for the About page. Recommended: 3:4 ratio, portrait orientation.</p>
        </div>
      </div>
    </div>

    <label>Description Paragraph 1</label>
    <textarea oninput="siteContent.about.description=this.value; markDirty()">${esc(a.description)}</textarea>
    <label>Description Paragraph 2</label>
    <textarea oninput="siteContent.about.description2=this.value; markDirty()">${esc(a.description2)}</textarea>
    <label>Description Paragraph 3</label>
    <textarea oninput="siteContent.about.description3=this.value; markDirty()">${esc(a.description3)}</textarea>
    <label>Universe Blurb (dark card)</label>
    <textarea oninput="siteContent.about.universeBlurb=this.value; markDirty()">${esc(a.universeBlurb)}</textarea>
    <div style="margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid var(--border);">
      <div class="card-title" style="margin-bottom:0.75rem;">🔗 Platform Links</div>
      <p style="font-size:0.78rem;color:var(--muted);margin-bottom:1rem;">These appear in the "Find the Work" section on the About page.</p>
      <label>Royal Road Profile URL</label>
      <input type="url" value="${esc(a.links?.royalroad||'')}" placeholder="https://www.royalroad.com/profile/..."
        oninput="if(!siteContent.about.links)siteContent.about.links={}; siteContent.about.links.royalroad=this.value; markDirty()">
      <label>ScribbleHub Profile URL</label>
      <input type="url" value="${esc(a.links?.scribblehub||'')}" placeholder="https://www.scribblehub.com/profile/..."
        oninput="if(!siteContent.about.links)siteContent.about.links={}; siteContent.about.links.scribblehub=this.value; markDirty()">
      <label>Wattpad Profile URL</label>
      <input type="url" value="${esc(a.links?.wattpad||'')}" placeholder="https://www.wattpad.com/user/..."
        oninput="if(!siteContent.about.links)siteContent.about.links={}; siteContent.about.links.wattpad=this.value; markDirty()">
      <label>Patreon URL</label>
      <input type="url" value="${esc(a.links?.patreon||'')}" placeholder="https://www.patreon.com/..."
        oninput="if(!siteContent.about.links)siteContent.about.links={}; siteContent.about.links.patreon=this.value; markDirty()">
      <label>Amazon KDP URL</label>
      <input type="url" value="${esc(a.links?.kdp||'')}" placeholder="https://www.amazon.com/..."
        oninput="if(!siteContent.about.links)siteContent.about.links={}; siteContent.about.links.kdp=this.value; markDirty()">
      <label>Discord Invite URL</label>
      <input type="url" value="${esc(a.links?.discord||'')}" placeholder="https://discord.gg/..."
        oninput="if(!siteContent.about.links)siteContent.about.links={}; siteContent.about.links.discord=this.value; markDirty()">
    </div>
  `;
}

// ── RENDER: VISIBILITY ────────────────────────────────────
function renderVisibilityPanel() {
  if (!siteContent) return;
  const container = document.getElementById('visibility-editor');
  let html = '';

  (siteContent.series || []).forEach((series, si) => {
    html += `
    <div style="margin-bottom:1.5rem;">
      <div class="toggle-row">
        <div>
          <div class="toggle-label" style="font-family:var(--display);">📖 ${esc(series.universe)}</div>
          <div class="toggle-sub">Series visibility</div>
        </div>
        <label class="toggle">
          <input type="checkbox" ${series.visible !== false ? 'checked' : ''}
            onchange="siteContent.series[${si}].visible=this.checked; markDirty()">
          <span class="toggle-slider"></span>
        </label>
      </div>
      ${series.books.map((book, bi) => `
        <div class="toggle-row" style="padding-left:1rem;">
          <div>
            <div class="toggle-label">${esc(book.title)}</div>
            <div class="toggle-sub">${esc(book.volume||'')}</div>
          </div>
          <label class="toggle">
            <input type="checkbox" ${book.visible !== false ? 'checked' : ''}
              onchange="siteContent.series[${si}].books[${bi}].visible=this.checked; markDirty()">
            <span class="toggle-slider"></span>
          </label>
        </div>
      `).join('')}
    </div>`;
  });

  const standalone = siteContent.books || [];
  if (standalone.length > 0) {
    html += `<div style="margin-bottom:1.5rem;">
      <div style="font-size:0.75rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-bottom:0.75rem;">📎 Standalone Books</div>
      ${standalone.map((book, bi) => `
        <div class="toggle-row">
          <div>
            <div class="toggle-label">${esc(book.title)}</div>
            <div class="toggle-sub">${esc(book.volume||'')}</div>
          </div>
          <label class="toggle">
            <input type="checkbox" ${book.visible !== false ? 'checked' : ''}
              onchange="siteContent.books[${bi}].visible=this.checked; markDirty()">
            <span class="toggle-slider"></span>
          </label>
        </div>
      `).join('')}
    </div>`;
  }

  container.innerHTML = html || '<p style="color:var(--muted);">No books or series yet.</p>';
}

// ── SAVE ──────────────────────────────────────────────────
async function saveContent() {
  if (!siteContent) { showToast('Nothing to save.', 'error'); return; }
  try {
    // /save-content -> SaveAllContent only reads the top-level `books` array
    // (books belong to a series via `series_id`, not by nesting), so flatten
    // series[i].books back out here or every book living inside a series
    // would silently vanish on save. See nestBooksIntoSeries for the
    // corresponding un-flatten on load.
    const res = await fetch('/save-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify(flattenSeriesBooks(siteContent)),
    });
    if (res.ok) {
      showToast('✓ Saved!');
      dirty = false;
      document.getElementById('save-banner').classList.remove('visible');
    } else {
      let msg = 'Save failed';
      try { const errBody = await res.json(); if (errBody.error) msg = errBody.error; } catch {}
      showToast(msg, 'error');
    }
  } catch(e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

// ── SEARCH / FILTER ──────────────────────────────────────
function filterBooks(term) {
  const t = term.toLowerCase();
  document.querySelectorAll('.book-editor').forEach(el => {
    const title = el.querySelector('.book-editor-title')?.textContent.toLowerCase() || '';
    el.style.display = (!t || title.includes(t)) ? '' : 'none';
  });
}

// ── DRAG AND DROP ─────────────────────────────────────────
let _dragSi = null, _dragBi = null;

function dragStart(e, si, bi) {
  _dragSi = si; _dragBi = bi;
  e.dataTransfer.effectAllowed = 'move';
  // small delay so the element doesn't disappear under the cursor immediately
  setTimeout(() => document.getElementById(`be-${si}-${bi}`)?.classList.add('dragging'), 0);
}

function dragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }

function dragEnter(e) {
  e.preventDefault();
  const el = e.currentTarget;
  if (el.classList.contains('book-editor')) el.classList.add('drag-over');
}

function dragLeave(e) {
  const el = e.currentTarget;
  // only remove if actually leaving the card (not just moving to a child)
  if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
}

async function saveBookOrder(si, bookIds) {
  const seriesId = si === -1 ? null : (siteContent.series[si] ? siteContent.series[si].id : null);
  try {
    const res = await fetch('/api/books/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ seriesId, bookIds })
    });
    if (!res.ok) throw new Error('Failed to save order');
    showToast('Order saved');
  } catch (e) {
    showToast('Order save failed: ' + e.message, 'error');
  }
}

function dragDrop(e, targetSi, targetBi) {
  e.preventDefault();
  document.querySelectorAll('.book-editor').forEach(el => {
    el.classList.remove('drag-over', 'dragging');
  });
  if (_dragSi === null) return;

  const sourceSi = _dragSi;
  const sourceBi = _dragBi;

  // Same list reorder
  if (sourceSi === targetSi && sourceBi !== targetBi) {
    const arr = getBooks(sourceSi);
    const [moved] = arr.splice(sourceBi, 1);
    arr.splice(targetBi, 0, moved);
    markDirty();
    renderBooksPanel();
    renderVisibilityPanel();
    saveBookOrder(sourceSi, arr.map(b => b.id));
  }
  // Cross-series move
  else if (sourceSi !== targetSi) {
    const book = getBooks(sourceSi).splice(sourceBi, 1)[0];
    getBooks(targetSi).splice(targetBi, 0, book);
    markDirty();
    renderBooksPanel();
    renderVisibilityPanel();
    showToast(`"${book.title}" moved.`);

    // Save both lists
    saveBookOrder(sourceSi, getBooks(sourceSi).map(b => b.id));
    saveBookOrder(targetSi, getBooks(targetSi).map(b => b.id));
  }
  _dragSi = null; _dragBi = null;
}


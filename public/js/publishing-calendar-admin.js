/* Behaviour for publishing-calendar-admin.html — moved out of the markup verbatim. */
  let entries = [];
  let editingId = null;

  function getCsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)nki_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function showMessage(ok, text) {
    const el = document.getElementById('message');
    el.className = 'message ' + (ok ? 'ok' : 'err');
    el.textContent = text;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function platformBadge(p) {
    const n = (p || '').toLowerCase();
    const k = n === 'royal road' ? 'RR' : (n === 'scribblehub' ? 'SH' : 'Other');
    return `<span class="badge badge-${k}">${k}</span>`;
  }

  async function loadEntries() {
    const res = await fetch('/api/admin/publishing-calendar', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showMessage(false, `Failed to load entries: ${body.error || res.status}`);
      return;
    }
    const data = await res.json();
    entries = data.entries || [];
    renderRows();
  }

  function renderRows() {
    const tbody = document.getElementById('rows');
    if (!entries.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">No manual entries yet. Click "+ Add Entry" to create one.</td></tr>`;
      return;
    }
    entries.sort((a, b) =>
      (b.release_date || '').localeCompare(a.release_date || '') ||
      (b.release_time || '').localeCompare(a.release_time || '')
    );
    let html = '';
    entries.forEach(e => {
      html += `<tr>
        <td>${escapeHtml(e.release_date)}</td>
        <td>${escapeHtml(e.title)}</td>
        <td>${escapeHtml(e.series)}</td>
        <td>${platformBadge(e.platform)}</td>
        <td>${escapeHtml(e.release_time || '—')}<br><span class="muted">${escapeHtml(e.timezone || '')}</span></td>
        <td>${e.url ? `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener noreferrer">link</a>` : '—'}</td>
        <td class="row-actions">
          <button class="edit" data-id="${escapeHtml(e.id)}" onclick="editEntry('${escapeHtml(e.id)}')">Edit</button>
          <button class="del" data-id="${escapeHtml(e.id)}" onclick="deleteEntry('${escapeHtml(e.id)}')">Delete</button>
        </td>
      </tr>`;
    });
    tbody.innerHTML = html;
  }

  function openForm(entry) {
    editingId = entry ? entry.id : null;
    document.getElementById('form-title').textContent = entry ? 'Edit Entry' : 'Add Entry';
    document.getElementById('f-id').value = entry ? entry.id : '';
    document.getElementById('f-title').value = entry ? (entry.title || '') : '';
    document.getElementById('f-series').value = entry ? (entry.series || '') : '';
    const plat = entry ? (entry.platform || 'Other') : 'Royal Road';
    document.getElementById('f-platform').value = platformName(plat);
    document.getElementById('f-date').value = entry ? (entry.release_date || '') : '';
    document.getElementById('f-time').value = entry ? (entry.release_time || '') : '';
    document.getElementById('f-timezone').value = entry ? (entry.timezone || 'America/Phoenix') : 'America/Phoenix';
    document.getElementById('f-url').value = entry ? (entry.url || '') : '';
    document.getElementById('f-notes').value = entry ? (entry.notes || '') : '';
    document.getElementById('form-panel').classList.add('open');
    document.getElementById('form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function platformName(p) {
    const n = (p || '').toLowerCase();
    if (n === 'royal road') return 'Royal Road';
    if (n === 'scribblehub') return 'ScribbleHub';
    return 'Other';
  }

  function closeForm() {
    editingId = null;
    document.getElementById('form-panel').classList.remove('open');
  }

  function collectPayload() {
    return {
      id: document.getElementById('f-id').value || undefined,
      title: document.getElementById('f-title').value.trim(),
      series: document.getElementById('f-series').value.trim(),
      platform: document.getElementById('f-platform').value,
      release_date: document.getElementById('f-date').value,
      release_time: document.getElementById('f-time').value || undefined,
      timezone: document.getElementById('f-timezone').value.trim() || 'America/Phoenix',
      url: document.getElementById('f-url').value.trim() || undefined,
      notes: document.getElementById('f-notes').value.trim() || undefined,
    };
  }

  document.getElementById('new-entry').addEventListener('click', () => openForm(null));
  document.getElementById('form-cancel').addEventListener('click', closeForm);

  document.getElementById('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = collectPayload();
    // Validate basics client-side
    if (!payload.title) { showMessage(false, 'Title is required.'); return; }
    if (!payload.series) { showMessage(false, 'Series is required.'); return; }
    if (!payload.release_date) { showMessage(false, 'Date is required.'); return; }

    const res = await fetch('/api/admin/publishing-calendar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMessage(false, `Save failed: ${body.error || res.status}`);
      return;
    }
    showMessage(true, 'Entry saved.');
    closeForm();
    await loadEntries();
  });

  async function editEntry(id) {
    const entry = entries.find(e => e.id === id);
    if (entry) openForm(entry);
  }

  async function deleteEntry(id) {
    if (!confirm('Delete this calendar entry?')) return;
    const res = await fetch(`/api/admin/publishing-calendar/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': getCsrfToken() },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showMessage(false, `Delete failed: ${body.error || res.status}`);
      return;
    }
    showMessage(true, 'Entry deleted.');
    await loadEntries();
  }

  loadEntries();

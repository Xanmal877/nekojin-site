/* Admin panel: timeline-users */
// ── TIMELINE ─────────────────────────────────────────────
function renderTimelineList(events) {
  const container = document.getElementById('timeline-list');
  if (!events.length) {
    container.innerHTML = '<div class="empty-state">No timeline events found.</div>';
    return;
  }
  container.innerHTML = events.map(e => `
    <div class="game-list-item">
      <div class="game-list-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--surface3);font-size:1.5rem;">🕰️</div>
      <div class="game-list-info">
        <div class="game-list-title">${esc(e.title)}</div>
        <div class="game-list-status">${esc(e.era || 'No era')} • ${e.visible ? 'Visible' : 'Hidden'}</div>
      </div>
      <div class="game-list-actions">
        <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${esc(e.id)}" title="Edit">✏️</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${esc(e.id)}" title="Delete">🗑️</button>
      </div>
    </div>
  `).join('');
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.action === 'edit') editTimelineEvent(btn.dataset.id);
      else if (btn.dataset.action === 'delete') deleteTimelineEvent(btn.dataset.id);
    });
  });
}

async function renderTimeline() {
  const container = document.getElementById('timeline-list');
  try {
    const res = await fetch('/api/timeline');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    timelineData = await res.json();
    renderTimelineList(timelineData);
  } catch(e) {
    container.innerHTML = `<p style="color:var(--red);">Error loading timeline: ${e.message}</p>`;
  }
}

function filterTimeline(query) {
  query = query.trim().toLowerCase();
  const filtered = query
    ? timelineData.filter(e => (e.title || '').toLowerCase().includes(query) || (e.era || '').toLowerCase().includes(query))
    : timelineData;
  renderTimelineList(filtered);
}

function openAddTimelineModal() {
  currentEditingTimelineId = null;
  document.getElementById('timeline-modal-title').textContent = 'Add Timeline Event';
  document.getElementById('timeline-title').value = '';
  document.getElementById('timeline-id').value = '';
  document.getElementById('timeline-era').value = '';
  document.getElementById('timeline-sort').value = '0';
  document.getElementById('timeline-desc').value = '';
  document.getElementById('timeline-chars').value = '';
  document.getElementById('timeline-book').value = '';
  document.getElementById('timeline-visible').checked = true;
  document.getElementById('timeline-modal').style.display = 'flex';
}

function closeTimelineModal() {
  document.getElementById('timeline-modal').style.display = 'none';
}

async function editTimelineEvent(id) {
  try {
    const res = await fetch(`/api/timeline/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ev = await res.json();

    currentEditingTimelineId = ev.id;
    document.getElementById('timeline-modal-title').textContent = 'Edit Timeline Event';
    document.getElementById('timeline-title').value = ev.title || '';
    document.getElementById('timeline-id').value = ev.id || '';
    document.getElementById('timeline-era').value = ev.era || '';
    document.getElementById('timeline-sort').value = ev.sort_order || 0;
    document.getElementById('timeline-desc').value = ev.description || '';
    document.getElementById('timeline-chars').value = (ev.related_character_slugs || []).join(', ');
    document.getElementById('timeline-book').value = ev.related_book_id || '';
    document.getElementById('timeline-visible').checked = !!ev.visible;

    document.getElementById('timeline-modal').style.display = 'flex';
  } catch(e) {
    showToast('Failed to load timeline event: ' + e.message, 'error');
  }
}

async function saveTimelineEvent() {
  const data = {
    id: currentEditingTimelineId || document.getElementById('timeline-id').value.trim() || undefined,
    title: document.getElementById('timeline-title').value.trim(),
    era: document.getElementById('timeline-era').value.trim(),
    sort_order: parseInt(document.getElementById('timeline-sort').value) || 0,
    description: document.getElementById('timeline-desc').value,
    related_character_slugs: document.getElementById('timeline-chars').value
      .split(',').map(s => s.trim()).filter(Boolean),
    related_book_id: document.getElementById('timeline-book').value.trim() || null,
    visible: document.getElementById('timeline-visible').checked
  };

  if (!data.title) {
    showToast('Title is required', 'error');
    return;
  }

  try {
    const res = await fetch('/api/timeline', {
      method: currentEditingTimelineId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast('Timeline event saved', 'success');
    closeTimelineModal();
    await renderTimeline();
  } catch(e) {
    showToast('Error saving timeline event: ' + e.message, 'error');
  }
}

async function deleteTimelineEvent(id) {
  if (!confirm('Are you sure you want to delete this timeline event?')) return;
  try {
    const res = await fetch(`/api/timeline/${id}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': getCsrfToken() }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast('Timeline event deleted', 'success');
    await renderTimeline();
  } catch(e) {
    showToast('Error deleting timeline event: ' + e.message, 'error');
  }
}
let usersData = [];

async function loadUsers() {
  const container = document.getElementById('users-list-container');
  if (!container) return;

  container.innerHTML = '<p style="color:var(--muted);">Loading users...</p>';

  try {
    const res = await fetch('/api/users');
    if (res.status === 403) {
      container.innerHTML = '<p style="color:var(--red);">Access denied. Admin privileges required.</p>';
      return;
    }
    if (res.status === 401) {
      container.innerHTML = '<p style="color:var(--red);">Session expired. Please <a href="/login">log in</a> again.</p>';
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    usersData = await res.json();
    renderUsersPanel();
  } catch (e) {
    console.error('loadUsers error:', e);
    container.innerHTML = '<p style="color:var(--red);">Error loading users: ' + e.message + '</p>';
  }
}

function renderUsersPanel() {
  const container = document.getElementById('users-list-container');
  if (!usersData.length) {
    container.innerHTML = '<p style="color:var(--muted);">No users found.</p>';
    return;
  }

  const rows = usersData.map(u => `
    <div class="user-row" style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 0;border-bottom:1px solid var(--border);"
      data-username="${esc(u.username)}">
      <div style="display:flex;align-items:center;gap:1rem;flex:1;">
        <div>
          <div style="font-weight:600;color:var(--text);">${esc(u.username)}</div>
          <div style="font-size:0.78rem;color:var(--muted);">Created: ${new Date(u.createdAt).toLocaleDateString()}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <span class="role-badge ${u.role}" style="padding:0.25rem 0.75rem;border-radius:999px;font-size:0.75rem;font-weight:600;text-transform:uppercase;background:${u.role === 'admin' ? 'rgba(232,176,32,0.15)' : 'rgba(124,58,237,0.15)'};color:${u.role === 'admin' ? 'var(--gold)' : 'var(--royal)'};border:1px solid ${u.role === 'admin' ? 'rgba(232,176,32,0.3)' : 'rgba(124,58,237,0.3)'};">
          ${u.role}
        </span>
        <select data-action="change-role" data-username="${esc(u.username)}" style="padding:0.4rem 0.6rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.8rem;cursor:pointer;"
          ${u.username === 'xanmal' ? 'disabled title="Cannot modify default admin"' : ''}>
          <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
        <button class="btn btn-ghost btn-sm" data-action="reset-password" data-username="${esc(u.username)}" ${u.username === 'xanmal' ? 'disabled' : ''}>Reset Password</button>
        <button class="btn btn-danger btn-sm" data-action="delete-user" data-username="${esc(u.username)}" ${u.username === 'xanmal' ? 'disabled' : ''}>Delete</button>
      </div>
    </div>
  `).join('');

  container.innerHTML = rows;
}

function openAddUserModal() {
  document.getElementById('add-user-modal').style.display = 'flex';
  document.getElementById('new-user-username').focus();
}

function closeAddUserModal() {
  document.getElementById('add-user-modal').style.display = 'none';
  document.getElementById('new-user-username').value = '';
  document.getElementById('new-user-password').value = '';
  document.getElementById('new-user-role').value = 'user';
}

async function createNewUser() {
  const username = document.getElementById('new-user-username').value.trim();
  const password = document.getElementById('new-user-password').value;
  const role = document.getElementById('new-user-role').value;

  if (!username || !password) {
    showToast('Username and password are required', 'error');
    return;
  }

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ username, password, role })
    });

    if (res.status === 409) {
      showToast('Username already exists', 'error');
      return;
    }
    if (!res.ok) throw new Error('Failed to create user');

    showToast(`User ${username} created successfully`, 'success');
    closeAddUserModal();
    await loadUsers();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function changeUserRole(username, role) {
  if (!confirm(`Change ${username}'s role to ${role}?`)) return;

  try {
    const res = await fetch(`/api/users/${encodeURIComponent(username)}/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ role })
    });

    if (!res.ok) throw new Error('Failed to change role');
    showToast(`Role updated for ${username}`, 'success');
    await loadUsers();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

let currentResetUsername = null;

function openResetPasswordModal(username) {
  currentResetUsername = username;
  document.getElementById('reset-password-username').textContent = username;
  document.getElementById('reset-password-input').value = '';
  document.getElementById('reset-password-modal').style.display = 'flex';
  document.getElementById('reset-password-input').focus();
}

function closeResetPasswordModal() {
  document.getElementById('reset-password-modal').style.display = 'none';
  currentResetUsername = null;
}

async function submitResetPassword() {
  const newPassword = document.getElementById('reset-password-input').value;
  if (!newPassword) {
    showToast('Password cannot be empty', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/users/${encodeURIComponent(currentResetUsername)}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ password: newPassword })
    });

    if (!res.ok) throw new Error('Failed to reset password');
    showToast(`Password reset for ${currentResetUsername}`, 'success');
    closeResetPasswordModal();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function resetUserPassword(username) {
  openResetPasswordModal(username);
}

async function deleteUser(username) {
  if (!confirm(`Are you sure you want to delete ${username}?\n\nThis will permanently remove the user account. This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': getCsrfToken() }
    });

    if (!res.ok) throw new Error('Failed to delete user');
    showToast(`User ${username} deleted`, 'success');
    await loadUsers();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}


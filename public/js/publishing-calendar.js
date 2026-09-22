/* Behaviour for publishing-calendar.html — moved out of the markup verbatim. */
  // ── STATE ──
  function phoenixTodayParts() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Phoenix', year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(new Date());
    return {
      year: Number(parts.find(p => p.type === 'year').value),
      month: Number(parts.find(p => p.type === 'month').value) - 1,
      day: Number(parts.find(p => p.type === 'day').value)
    };
  }
  const todayParts = phoenixTodayParts();
  let viewYear = todayParts.year;
  let viewMonth = todayParts.month; // 0-indexed

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Month's first day as YYYY-MM-DD (local, no TZ reinterpretation)
  function firstOfMonth(y, m) {
    return `${y}-${String(m + 1).padStart(2, '0')}-01`;
  }
  function nextFirst(y, m) {
    if (m === 11) return `${y + 1}-01-01`;
    return `${y}-${String(m + 2).padStart(2, '0')}-01`;
  }
  function fmt(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }

  let cachedData = { start: null, end: null, byDate: {} };

  async function loadMonth(y, m) {
    const start = firstOfMonth(y, m);
    const end = nextFirst(y, m);

    // Use a cache for the range so back/forth is snappy; refetch on change.
    if (cachedData.start === start && cachedData.end === end) {
      render(y, m);
      return;
    }

    const res = await fetch(`/api/public/publishing-calendar?start=${start}&end=${end}`);
    if (!res.ok) {
      showError(`Couldn't load the calendar (server responded ${res.status}). Please try again.`);
      cachedData = { start: null, end: null, byDate: {} };
      return;
    }
    const data = await res.json();
    const byDate = {};
    mergeReleases(data.entries || []).forEach(e => {
      const key = e.date || '';
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(e);
    });
    cachedData = { start, end, byDate };
    hideError();
    render(y, m);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Convert the source's local wall-clock time to an instant, then format it
  // in the browser's timezone. This keeps the calendar useful internationally.
  function localTimeLabel(r) {
    if (!r.time || !r.date) return '';
    try {
      const [year, month, day] = r.date.split('-').map(Number);
      const [hour, minute] = r.time.split(':').map(Number);
      const guess = Date.UTC(year, month - 1, day, hour, minute);
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: r.timezone || 'America/Phoenix',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date(guess));
      const values = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
      const sourceAsUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute);
      const instant = new Date(guess - (sourceAsUtc - guess));
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(instant);
    } catch (_) {
      return r.time;
    }
  }

  function badgeFor(e) {
    const keys = e.platformKeys || [e.platformKey];
    return keys.map(k => {
      const key = k === 'SH' ? 'SH' : (k === 'RR' ? 'RR' : 'Other');
      const label = key === 'RR' ? 'RR' : key === 'SH' ? 'SH' : 'Other';
      return `<span class="badge badge-${key}">${label}</span>`;
    }).join(' ');
  }

  function mergeReleases(entries) {
    const grouped = new Map();
    entries.forEach(entry => {
      const key = [entry.date, entry.time || '', entry.title || '', entry.series || ''].join('\u001f');
      const platformKey = entry.platformKey === 'SH' ? 'SH' : (entry.platformKey === 'RR' ? 'RR' : 'Other');
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          ...entry,
          platformKeys: [platformKey],
          urls: entry.url ? [{ platformKey, url: entry.url }] : []
        });
        return;
      }
      if (!existing.platformKeys.includes(platformKey)) existing.platformKeys.push(platformKey);
      if (entry.url && !existing.urls.some(link => link.url === entry.url)) {
        existing.urls.push({ platformKey, url: entry.url });
      }
    });
    return Array.from(grouped.values()).map(entry => {
      entry.platformKeys.sort((a, b) => ({ RR: 0, SH: 1, Other: 2 }[a] ?? 3) - ({ RR: 0, SH: 1, Other: 2 }[b] ?? 3));
      return entry;
    });
  }

  function releaseLinks(entry) {
    const links = entry.urls || (entry.url ? [{ platformKey: entry.platformKey, url: entry.url }] : []);
    return links.map(link => {
      const label = link.platformKey === 'RR' ? 'View RR' : link.platformKey === 'SH' ? 'View SH' : 'View';
      return `<a class="rel-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${label} →</a>`;
    }).join(' ');
  }

  function render(y, m) {
    document.getElementById('cal-title').textContent = `${MONTHS[m]} ${y}`;
    const todayStr = fmt(todayParts.year, todayParts.month, todayParts.day);

    let html = `<div class="cal-grid">`;
    DOW.forEach(d => html += `<div class="cal-dow">${d}</div>`);

    // Leading blanks based on first-of-month weekday (local)
    const firstWeekday = new Date(y, m, 1).getDay();
    for (let i = 0; i < firstWeekday; i++) {
      html += `<div class="cal-cell heading"></div>`;
    }

    const dim = daysInMonth(y, m);
    for (let d = 1; d <= dim; d++) {
      const dateKey = fmt(y, m, d);
      const rels = cachedData.byDate[dateKey] || [];
      const isToday = dateKey === todayStr;
      let cellClass = 'cal-cell' + (rels.length ? ' release-cell' : '') +
        (isToday ? ' is-today' : '');
      html += `<div class="${cellClass}">
        <div class="cal-daynum">${d}</div>`;
      // Show up to 3 on desktop grid; "+n more" for the rest
      const shown = rels.slice(0, 3);
      shown.forEach(r => {
        const t = escapeHtml(r.title || 'Untitled');
        const s = escapeHtml(r.series || '');
        const timeSuffix = localTimeLabel(r) ? ` · ${escapeHtml(localTimeLabel(r))}` : '';
        const platformKeys = r.platformKeys || [r.platformKey];
        const platformMarks = platformKeys.map(platformKey => {
          const platformLabel = platformKey === 'Other' ? 'Other' : platformKey;
          return `<span class="platform-mark ${platformKey}">${platformLabel}</span>`;
        }).join(' ');
        html += `<div class="cal-release"><span class="t">${platformMarks}${t}${timeSuffix}</span><span class="s">${s}</span></div>`;
      });
      if (rels.length > 3) {
        html += `<div class="cal-release more">+${rels.length - 3} more</div>`;
      }
      html += `</div>`;
    }

    // Trailing blanks
    const lastWeekday = new Date(y, m, dim).getDay();
    for (let i = lastWeekday + 1; i < 7; i++) {
      html += `<div class="cal-cell heading"></div>`;
    }

    html += `</div>`;
    document.getElementById('calendar').innerHTML = html;
    renderReleaseList(m);
  }

  function renderReleaseList(m) {
    const listEl = document.getElementById('release-list');
    // Collect all entries for this month, sorted by date/time
    const all = [];
    Object.entries(cachedData.byDate).forEach(([date, rels]) => {
      rels.forEach(r => all.push({ ...r, date }));
    });
    all.sort((a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time || '').localeCompare(b.time || '') ||
      a.platform.localeCompare(b.platform)
    );

    // Only show entries within the viewed month
    const start = firstOfMonth(viewYear, viewMonth);
    const end = nextFirst(viewYear, viewMonth);
    const filtered = all.filter(r => r.date >= start && r.date < end);

    if (!filtered.length) {
      listEl.innerHTML = `<div class="empty">No releases showing for ${MONTHS[m]} ${viewYear}.</div>`;
      return;
    }

    let html = '';
    filtered.forEach(r => {
      const dateParts = r.date.split('-');
      const dateLabel = r.date; // YYYY-MM-DD
       const timeLabel = localTimeLabel(r) ? ` · ${escapeHtml(localTimeLabel(r))}` : '';
      const platformLabel = `${r.platformKey === 'SH' ? 'ScribbleHub' : (r.platformKey === 'RR' ? 'Royal Road' : r.platform)}`;
      html += `<div class="release-card">
        <div class="rel-date">${dateLabel}${timeLabel}</div>
        <div class="rel-main">
          <div class="rel-title">${escapeHtml(r.title)}</div>
          <div class="rel-series">${escapeHtml(r.series)}</div>
        </div>
        <div class="rel-badges">
          ${badgeFor(r)}
          <span class="badge badge-manual" style="display:none;" data-manual="${r.source === 'manual' ? '1' : '0'}">Manual</span>
          ${r.source === 'manual' ? '<span class="badge badge-manual">Manual</span>' : ''}
        </div>
          ${releaseLinks(r)}
      </div>`;
    });
    listEl.innerHTML = html;
  }

  function showError(msg) {
    const el = document.getElementById('error-banner');
    el.textContent = msg;
    el.style.display = 'block';
  }
  function hideError() {
    document.getElementById('error-banner').style.display = 'none';
  }

  document.getElementById('prev-month').addEventListener('click', () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    loadMonth(viewYear, viewMonth);
  });
  document.getElementById('next-month').addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    loadMonth(viewYear, viewMonth);
  });
  document.getElementById('cal-today').addEventListener('click', () => {
    viewYear = todayParts.year;
    viewMonth = todayParts.month;
    loadMonth(viewYear, viewMonth);
  });

  // ── THEME ──

  document.getElementById('theme-icon').textContent =
    (localStorage.getItem('theme') || 'light') === 'dark' ? '🌙' : '☀️';

  loadMonth(viewYear, viewMonth);

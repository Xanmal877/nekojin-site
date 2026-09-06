import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, List, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, formatLocalDate, type CatalogRow } from '../api'

type ViewMode = 'calendar' | 'list'

// All releases in the publishing DB use America/Phoenix (UTC-7, no DST). The
// calendar groups releases by their *local* date (Phoenix), not UTC, so a
// release scheduled for 9pm Phoenix on the 5th shows on the 5th even though
// its UTC timestamp is the 6th.
const PHOENIX_UTC_OFFSET_MS = 7 * 60 * 60 * 1000

function localMonthUtcBounds(year: number, month: number): { startUtc: string; endUtc: string } {
  // Local month start/end as Phoenix wall-clock, converted to UTC by adding 7h.
  const startUtc = new Date(Date.UTC(year, month, 1) + PHOENIX_UTC_OFFSET_MS)
  const endUtc = new Date(Date.UTC(year, month + 1, 1) + PHOENIX_UTC_OFFSET_MS)
  return {
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
  }
}

export default function Releases() {
  const [rows, setRows] = useState<CatalogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ViewMode>('calendar')
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const year = cursor.getFullYear()
  const month = cursor.getMonth()

  // Fetch only the releases in the displayed month's local (Phoenix) window.
  useEffect(() => {
    setLoading(true)
    const { startUtc, endUtc } = localMonthUtcBounds(year, month)
    api
      .releaseWindow({ startUtc, endUtc })
      .then((res) => {
        setRows(res.releases)
        setError(null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [year, month])

  // Group by local date (releaseDateTime, Phoenix wall-clock).
  const byDate = useMemo(() => {
    const map = new Map<string, CatalogRow[]>()
    for (const r of rows) {
      const local = r.releaseDateTime || r.releaseDateTimeUtc
      if (!local) continue
      const key = local.slice(0, 10)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return map
  }, [rows])

  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    const startDay = first.getDay() // 0 = Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: (Date | null)[] = []
    for (let i = 0; i < startDay; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
    return cells
  }, [year, month])

  const monthLabel = cursor.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const shiftMonth = (delta: number) => {
    setCursor(new Date(year, month + delta, 1))
  }

  const monthTotal = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
    let count = 0
    for (const [k, v] of byDate) {
      if (k.startsWith(prefix)) count += v.length
    }
    return count
  }, [byDate, year, month])

  const platformKey = (platform: string) => {
    if (platform === 'Royal Road') return 'RR'
    if (platform === 'ScribbleHub') return 'SH'
    return 'Other'
  }

  return (
    <div className="view">
      <div className="view-head">
        <h2>Releases</h2>
        <p className="view-sub">Calendar and list views of the release schedule.</p>
      </div>

      <div className="segmented" role="group" aria-label="Releases view mode">
        <button
          className={mode === 'calendar' ? 'active' : ''}
          aria-pressed={mode === 'calendar'}
          onClick={() => setMode('calendar')}
        >
          <CalendarDays size={15} strokeWidth={1.75} /> Calendar
        </button>
        <button
          className={mode === 'list' ? 'active' : ''}
          aria-pressed={mode === 'list'}
          onClick={() => setMode('list')}
        >
          <List size={15} strokeWidth={1.75} /> List
        </button>
      </div>

      {error && <div className="empty-state">Failed to load releases: {error}</div>}
      {loading && <div className="empty-state">Loading releases…</div>}

      {!loading && !error && mode === 'calendar' && (
        <section className="panel">
          <div className="calendar-head">
            <button className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <ChevronLeft size={18} strokeWidth={1.75} />
            </button>
            <h3>{monthLabel}</h3>
            <button className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
              <ChevronRight size={18} strokeWidth={1.75} />
            </button>
            <span className="panel-tag">{monthTotal} releases</span>
          </div>
          <div className="calendar-grid" role="grid" aria-label={`Release calendar for ${monthLabel}`}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="cal-dow" role="columnheader">
                {d}
              </div>
            ))}
            {cells.map((date, i) => {
              if (!date) return <div key={`empty-${i}`} className="cal-cell empty" />
              const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(
                date.getDate()
              ).padStart(2, '0')}`
              const dayReleases = byDate.get(key) || []
               const today = new Intl.DateTimeFormat('en-CA', {
                 timeZone: 'America/Phoenix',
               }).format(new Date())
               const isToday = key === today
              return (
                <div
                  key={key}
                  role="gridcell"
                  aria-label={`${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}, ${dayReleases.length} release${dayReleases.length === 1 ? '' : 's'}`}
                  className={`cal-cell ${isToday ? 'today' : ''}`}
                >
                  <span className="cal-daynum">{date.getDate()}</span>
                  <div className="cal-releases">
                    {dayReleases.slice(0, 3).map((r) => (
                      <div key={r.releaseId} className="cal-release" title={r.title}>
                        <span className={`cal-dot ${r.status.toLowerCase()}`} />
                        <span className={`cal-platform ${platformKey(r.platform)}`}>{platformKey(r.platform)}</span>
                        <span className="cal-release-title">{r.title}</span>
                      </div>
                    ))}
                    {dayReleases.length > 3 && (
                      <span className="cal-more">+{dayReleases.length - 3} more</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {!loading && !error && mode === 'list' && (
        <section className="panel">
          <div className="panel-head">
            <h3>Releases in {monthLabel}</h3>
            <span className="panel-tag">{rows.length} shown</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">Releases in {monthLabel}</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Title</th>
                  <th scope="col">Series</th>
                  <th scope="col">Platform</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Words
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.releaseId}>
                   <td>{formatLocalDate(r.releaseDateTime, r.releaseDateTimeUtc)}</td>
                    <td>
                      <div className="cell-title">
                        <span>{r.title}</span>
                        <span className="cell-sub">{r.chapterLabel}</span>
                      </div>
                    </td>
                    <td>{r.series}</td>
                    <td>{r.platform}</td>
                    <td>
                      <span className={`status-chip ${r.status.toLowerCase()}`}>{r.status}</span>
                    </td>
                    <td className="num">{r.wordCount ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

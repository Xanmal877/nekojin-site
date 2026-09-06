import { useEffect, useRef, useState } from 'react'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, formatCompact, formatLocalDate, type CatalogRow, type Filters } from '../api'

const PAGE_SIZE = 50

export default function Catalog() {
  const [filters, setFilters] = useState<Filters | null>(null)
  const [rows, setRows] = useState<CatalogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [summary, setSummary] = useState({ words: 0, views: 0 })

  const [q, setQ] = useState('')
  const [series, setSeries] = useState('')
  const [platform, setPlatform] = useState('')
  const [status, setStatus] = useState('')

  // AbortController guards against out-of-order responses when filters change
  // quickly: only the latest request is allowed to update state.
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    api.filters().then(setFilters).catch(() => setFilters(null))
  }, [])

  useEffect(() => {
    setLoading(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const params: Record<string, string | undefined> = {
      q,
      series,
      platform,
      status,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    }

    api
      .catalog(params, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return
        setRows(res.releases)
        setTotal(res.total)
        setTotalPages(res.totalPages)
        setSummary(res.summary)
        setError(null)
      })
      .catch((e) => {
        if (controller.signal.aborted) return
        setError(e.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [q, series, platform, status, page])

  // Reset to page 1 whenever a filter changes.
  const prevFilter = useRef('')
  const filterKey = `${q}|${series}|${platform}|${status}`
  useEffect(() => {
    if (prevFilter.current !== '' && prevFilter.current !== filterKey) {
      setPage(1)
    }
    prevFilter.current = filterKey
  }, [filterKey])

  return (
    <div className="view">
      <div className="view-head">
        <h2>Catalog</h2>
        <p className="view-sub">Every release across series and platforms.</p>
      </div>

      <div className="filter-bar">
        <div className="search-box">
          <Search size={16} strokeWidth={1.75} />
          <label htmlFor="catalog-search" className="sr-only">
            Search releases
          </label>
          <input
            id="catalog-search"
            type="text"
            placeholder="Search title, chapter, series…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label htmlFor="catalog-series" className="sr-only">
          Filter by series
        </label>
        <select id="catalog-series" value={series} onChange={(e) => setSeries(e.target.value)}>
          <option value="">All series</option>
          {filters?.series.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label htmlFor="catalog-platform" className="sr-only">
          Filter by platform
        </label>
        <select id="catalog-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="">All platforms</option>
          {filters?.platforms.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label htmlFor="catalog-status" className="sr-only">
          Filter by status
        </label>
        <select id="catalog-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {filters?.statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="catalog-summary">
        <span>
          <strong>{formatCompact(total)}</strong> releases
        </span>
        <span>
          <strong>{formatCompact(summary.words)}</strong> words
        </span>
        <span>
          <strong>{formatCompact(summary.views)}</strong> views
        </span>
      </div>

      {error && <div className="empty-state">Failed to load catalog: {error}</div>}
      {loading && <div className="empty-state">Loading catalog…</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="empty-state">No releases match the current filters.</div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">
                Release catalog, page {page} of {totalPages}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Series</th>
                  <th scope="col">Platform</th>
                  <th scope="col">Status</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="num">
                    Words
                  </th>
                  <th scope="col" className="num">
                    Views
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.releaseId}>
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
                    <td>{formatLocalDate(r.releaseDateTime, r.releaseDateTimeUtc)}</td>
                    <td className="num">{formatCompact(r.wordCount)}</td>
                    <td className="num">{formatCompact(r.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="pagination" aria-label="Catalog pagination">
            <button
              className="icon-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft size={18} strokeWidth={1.75} />
            </button>
            <span className="pagination-info">
              Page <strong>{page}</strong> of <strong>{totalPages}</strong>
            </span>
            <button
              className="icon-btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight size={18} strokeWidth={1.75} />
            </button>
          </nav>
        </>
      )}
    </div>
  )
}

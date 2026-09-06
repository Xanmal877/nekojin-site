import { useEffect, useState } from 'react'
import { api, formatCompact, formatDate, type SeriesAnalyticsRow } from '../api'

export default function SeriesAnalytics() {
  const [rows, setRows] = useState<SeriesAnalyticsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .series()
      .then((res) => {
        setRows(res.rows)
        setError(null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const maxReleases = Math.max(1, ...rows.map((r) => r.totalReleases))
  const maxViews = Math.max(1, ...rows.map((r) => r.totalViews))

  return (
    <div className="view">
      <div className="view-head">
        <h2>Series Analytics</h2>
        <p className="view-sub">Performance and output across each series.</p>
      </div>

      {error && <div className="empty-state">Failed to load series: {error}</div>}
      {loading && <div className="empty-state">Loading series…</div>}

      {!loading && !error && (
        <div className="series-grid">
          {rows.map((r) => {
            return (
              <section key={r.series} className="panel series-card">
                <div className="series-card-head">
                  <h3>{r.series}</h3>
                  <span className="status-chip published">{r.publishedCount} published</span>
                </div>

                <div className="series-stats">
                  <div className="series-stat">
                    <span className="series-stat-value">{r.totalReleases}</span>
                    <span className="series-stat-label">releases</span>
                  </div>
                  <div className="series-stat">
                    <span className="series-stat-value">{formatCompact(r.totalViews)}</span>
                    <span className="series-stat-label">views</span>
                  </div>
                  <div className="series-stat">
                    <span className="series-stat-value">{r.platformCount}</span>
                    <span className="series-stat-label">platforms</span>
                  </div>
                </div>

                <div className="series-bars">
                  <div className="series-bar-row">
                    <span className="series-bar-label">Releases</span>
                    <div className="series-bar-track">
                      <div
                        className="series-bar-fill coral"
                        style={{ width: `${(r.totalReleases / maxReleases) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="series-bar-row">
                    <span className="series-bar-label">Views</span>
                    <div className="series-bar-track">
                      <div
                        className="series-bar-fill amber"
                        style={{ width: `${(r.totalViews / maxViews) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="series-detail">
                  <div className="series-detail-row">
                    <span>Published</span>
                    <strong>{r.publishedCount}</strong>
                  </div>
                  <div className="series-detail-row">
                    <span>Platforms</span>
                    <strong>{r.platformCount}</strong>
                  </div>
                  <div className="series-detail-row">
                    <span>First release</span>
                    <strong>{formatDate(r.firstRelease)}</strong>
                  </div>
                  <div className="series-detail-row">
                    <span>Latest release</span>
                    <strong>{formatDate(r.lastRelease)}</strong>
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

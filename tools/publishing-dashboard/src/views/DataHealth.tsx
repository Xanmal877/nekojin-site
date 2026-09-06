import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, History } from 'lucide-react'
import { api, formatCompact, relativeTime, type Health, type HealthChecks } from '../api'

function HealthRow({
  label,
  value,
  ok,
}: {
  label: string
  value: string
  ok: boolean
}) {
  return (
    <div className="health-row">
      <span className={`health-icon ${ok ? 'ok' : 'warn'}`}>
        {ok ? <CheckCircle2 size={16} strokeWidth={1.75} /> : <AlertTriangle size={16} strokeWidth={1.75} />}
      </span>
      <span className="health-label">{label}</span>
      <span className="health-value">{value}</span>
    </div>
  )
}

export default function DataHealth() {
  const [health, setHealth] = useState<Health | null>(null)
  const [checks, setChecks] = useState<HealthChecks | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
    api
      .healthChecks()
      .then(setChecks)
      .catch((e) => setError(e.message))
  }, [])

  const t = checks?.tables
  const db = checks?.database

  return (
    <div className="view">
      <div className="view-head">
        <h2>Data Health</h2>
        <p className="view-sub">Completeness and integrity of the publishing database.</p>
      </div>

      {error && <div className="empty-state">Failed to load health checks: {error}</div>}

      <div className="panel-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>Database</h3>
            <span className="panel-tag">source</span>
          </div>
          {db && (
            <div className="health-list">
              <HealthRow label="Integrity check" value={db.ok ? 'ok' : 'failed'} ok={db.ok} />
              <HealthRow label="File" value={db.path ? db.path.split('/').pop() || '—' : '—'} ok={db.ok} />
              {db.error && <HealthRow label="Error" value={db.error} ok={false} />}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Table Counts</h3>
            <span className="panel-tag">rows</span>
          </div>
          {t && (
            <div className="health-list">
              <HealthRow label="Releases" value={formatCompact(t.releases)} ok={t.releases > 0} />
              <HealthRow label="Content items" value={formatCompact(t.contentItems)} ok={t.contentItems > 0} />
              <HealthRow label="Series" value={formatCompact(t.series)} ok={t.series > 0} />
              <HealthRow label="Platforms" value={formatCompact(t.platforms)} ok={t.platforms > 0} />
              <HealthRow label="Metric snapshots" value={formatCompact(t.releaseMetrics)} ok={t.releaseMetrics > 0} />
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Warnings</h3>
            <span className="panel-tag">data quality</span>
          </div>
          {checks && (
            <div className="health-list">
              {checks.warnings.length === 0 && (
                <HealthRow label="No warnings" value="all clear" ok />
              )}
              {checks.warnings.map((w, i) => (
                <HealthRow key={i} label="Warning" value={w} ok={false} />
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Recent Activity</h3>
            <span className="panel-tag">latest</span>
          </div>
          {checks && (
            <div className="health-list">
              <div className="health-row">
                <span className="health-icon ok">
                  <History size={16} strokeWidth={1.75} />
                </span>
                <span className="health-label">Latest release</span>
                <span className="health-value">
                  {checks.recentActivity.latestRelease
                    ? relativeTime(checks.recentActivity.latestRelease.dateTime)
                    : '—'}
                </span>
              </div>
              <div className="health-row">
                <span className="health-icon ok">
                  <History size={16} strokeWidth={1.75} />
                </span>
                <span className="health-label">Metrics captured</span>
                <span className="health-value">
                  {checks.recentActivity.latestMetricCapture
                    ? relativeTime(checks.recentActivity.latestMetricCapture)
                    : '—'}
                </span>
              </div>
              <div className="health-row">
                <span className="health-icon ok">
                  <Database size={16} strokeWidth={1.75} />
                </span>
                <span className="health-label">Checked at</span>
                <span className="health-value">
                  {health ? relativeTime(health.timestamp) : '—'}
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

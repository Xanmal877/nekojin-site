import { useEffect, useState } from 'react'
import {
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Eye,
  Type,
  TrendingUp,
} from 'lucide-react'
import {
  api,
  formatCompact,
  formatDate,
  formatLocalDate,
  formatLocalTime,
  parseDate,
  relativeTime,
  type Freshness,
  type Health,
  type Overview,
} from '../api'

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof BookOpen
  label: string
  value: string
  sub?: string
  accent: string
}) {
  return (
    <div className="kpi-card">
      <div className={`kpi-icon ${accent}`}>
        <Icon size={20} strokeWidth={1.75} />
      </div>
      <div className="kpi-body">
        <span className="kpi-label">{label}</span>
        <span className="kpi-value">{value}</span>
        {sub && <span className="kpi-sub">{sub}</span>}
      </div>
    </div>
  )
}

function BarChart({
  data,
  height = 180,
}: {
  data: { label: string; value: number }[]
  height?: number
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="bar-chart" style={{ height }} role="img" aria-label="Release cadence bar chart">
      {data.map((d) => (
        <div key={d.label} className="bar-col" title={`${d.label}: ${d.value}`}>
          <div className="bar-track">
            <div className="bar-fill" style={{ height: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="bar-label">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

function HBar<T>({
  data,
  valueKey,
  labelKey,
  format,
}: {
  data: T[]
  valueKey: keyof T
  labelKey: keyof T
  format: (n: number) => string
}) {
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0))
  return (
    <div className="hbar-list">
      {data.map((d) => {
        const v = Number(d[valueKey]) || 0
        return (
          <div key={String(d[labelKey])} className="hbar-row">
            <div className="hbar-top">
              <span className="hbar-label">{String(d[labelKey])}</span>
              <span className="hbar-value">{format(v)}</span>
            </div>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${(v / max) * 100}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Overview() {
  const [data, setData] = useState<Overview | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [freshness, setFreshness] = useState<Freshness | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.overview().then(setData).catch((e) => setError(e.message))
    api.health().then(setHealth).catch(() => setHealth(null))
    api.freshness().then(setFreshness).catch(() => setFreshness(null))
  }, [])

  if (error) return <div className="empty-state">Failed to load overview: {error}</div>
  if (!data) return <div className="empty-state">Loading overview…</div>

  const { kpis, cadence, series, platforms, upcoming } = data

  return (
    <div className="view">
      <div className="view-head">
        <h2>Overview</h2>
        <p className="view-sub">The state of the publishing slate at a glance.</p>
      </div>

      <div className="kpi-grid">
        <KpiCard icon={BookOpen} label="Releases" value={formatCompact(kpis.totalReleases)} sub={`${kpis.seriesCount} series · ${kpis.platformCount} platforms`} accent="coral" />
        <KpiCard icon={CheckCircle2} label="Published" value={formatCompact(kpis.publishedCount)} sub="live on platforms" accent="amber" />
        <KpiCard icon={Clock} label="Scheduled" value={formatCompact(kpis.scheduledCount)} sub="in the pipeline" accent="teal" />
        <KpiCard icon={FileText} label="Drafts" value={formatCompact(kpis.draftCount)} sub="in progress" accent="slate" />
        <KpiCard icon={Eye} label="Views" value={formatCompact(data.series.reduce((a, s) => a + s.views, 0))} sub="latest recorded" accent="coral" />
        <KpiCard icon={Type} label="Words" value={formatCompact(data.series.reduce((a, s) => a + s.words, 0))} sub="across all releases" accent="amber" />
      </div>

      <div className="panel-grid">
        <section className="panel panel-wide">
          <div className="panel-head">
            <h3>Release Cadence</h3>
            <span className="panel-tag">Published per month</span>
          </div>
          <BarChart data={cadence.map((c) => ({ label: c.month.slice(2), value: c.releases }))} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Series Comparison</h3>
            <span className="panel-tag">by releases</span>
          </div>
          <HBar data={series} valueKey="releases" labelKey="series" format={formatCompact} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Platform Comparison</h3>
            <span className="panel-tag">by releases</span>
          </div>
          <HBar data={platforms} valueKey="releases" labelKey="platform" format={formatCompact} />
        </section>

        <section className="panel panel-wide">
          <div className="panel-head">
            <h3>Upcoming Releases</h3>
            <span className="panel-tag">next scheduled</span>
          </div>
          <div className="upcoming-list">
            {upcoming.length === 0 && <div className="empty-state">No scheduled releases.</div>}
            {upcoming.map((r) => {
              const d = parseDate(r.releaseDateTimeUtc)
              return (
                <div key={r.releaseId} className="upcoming-row">
                  <div className="upcoming-date">
                   <span className="upcoming-day">{formatLocalDate(r.releaseDateTime, r.releaseDateTimeUtc)}</span>
                    <span className="upcoming-time">
                     {formatLocalTime(r.releaseDateTime) || (d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—')}
                    </span>
                  </div>
                  <div className="upcoming-main">
                    <span className="upcoming-title">{r.title}</span>
                    <span className="upcoming-meta">
                      {r.series} · {r.platform} · {r.chapterLabel}
                    </span>
                  </div>
                  <span className={`status-chip ${r.status.toLowerCase()}`}>{r.status}</span>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Data Freshness</h3>
          <span className="panel-tag">last sync</span>
        </div>
        <div className="freshness-grid">
          <div className="freshness-item">
            <TrendingUp size={16} strokeWidth={1.75} />
            <div>
              <span className="freshness-label">Metrics captured</span>
              <span className="freshness-value">
                {freshness?.metrics_captured_at ? relativeTime(freshness.metrics_captured_at) : '—'}
              </span>
            </div>
          </div>
          <div className="freshness-item">
            <TrendingUp size={16} strokeWidth={1.75} />
            <div>
              <span className="freshness-label">Database</span>
              <span className="freshness-value">{health?.path ? health.path.split('/').pop() : '—'}</span>
            </div>
          </div>
          <div className="freshness-item">
            <TrendingUp size={16} strokeWidth={1.75} />
            <div>
              <span className="freshness-label">Latest release</span>
              <span className="freshness-value">
                {freshness?.latest_release_utc ? formatDate(freshness.latest_release_utc) : '—'}
              </span>
            </div>
          </div>
          <div className="freshness-item">
            <TrendingUp size={16} strokeWidth={1.75} />
            <div>
              <span className="freshness-label">Scheduled</span>
              <span className="freshness-value">{formatCompact(kpis.scheduledCount)}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

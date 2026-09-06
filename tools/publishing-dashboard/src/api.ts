// Shared API types and a tiny fetch helper for the publishing dashboard.
// All calls are same-origin relative requests to /api/publishing/*, which the
// root CommonJS server exposes behind the admin auth gate.

export interface CatalogRow {
  releaseId: number
  platform: string
  series: string
  chapterLabel: string | null
  chapterNumber: number | null
  contentType: string
  title: string
  releaseDateTime: string | null
  releaseTimezone: string | null
  releaseDateTimeUtc: string | null
  status: 'Published' | 'Scheduled' | 'Draft'
  wordCount: number | null
  views: number | null
  metric2: number | null
  metric3: number | null
  url: string | null
  notes: string | null
}

export interface Kpis {
  totalReleases: number
  publishedCount: number
  scheduledCount: number
  draftCount: number
  platformCount: number
  seriesCount: number
}

export interface CadencePoint {
  month: string
  releases: number
}

export interface SeriesPoint {
  series: string
  releases: number
  words: number
  views: number
}

export interface PlatformPoint {
  platform: string
  releases: number
  words: number
  views: number
}

export interface Overview {
  kpis: Kpis
  cadence: CadencePoint[]
  series: SeriesPoint[]
  platforms: PlatformPoint[]
  upcoming: CatalogRow[]
}

export interface SeriesAnalyticsRow {
  series: string
  totalReleases: number
  publishedCount: number
  platformCount: number
  totalViews: number
  firstRelease: string | null
  lastRelease: string | null
}

export interface HealthChecks {
  database: {
    ok: boolean
    integrityMessage?: string
    path?: string
    error?: string
  }
  tables: {
    series: number
    platforms: number
    contentItems: number
    releases: number
    releaseMetrics: number
  }
  recentActivity: {
    latestRelease: { releaseId: number; dateTime: string; series: string } | null
    latestMetricCapture: string | null
  }
  warnings: string[]
  timestamp: string
}

export interface Filters {
  series: string[]
  platforms: string[]
  statuses: string[]
}

export interface Freshness {
  metrics_captured_at: string | null
  last_imported_at: string | null
  latest_release_utc: string | null
  import_count: number
  status_history_count: number
}

export interface Health {
  ok: boolean
  timestamp: string
  path: string
}

export interface CatalogResponse {
  releases: CatalogRow[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  summary: { words: number; views: number }
}

export interface SeriesResponse {
  rows: SeriesAnalyticsRow[]
}

export interface ReleaseWindowResponse {
  releases: CatalogRow[]
}

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body && body.error) detail = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => get<Health>('/api/publishing/health'),
  overview: () => get<Overview>('/api/publishing/overview'),
  catalog: (params: Record<string, string | undefined>, signal?: AbortSignal) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v) qs.set(k, v)
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return get<CatalogResponse>(`/api/publishing/catalog${suffix}`, signal)
  },
  filters: () => get<Filters>('/api/publishing/filters'),
  series: () => get<SeriesResponse>('/api/publishing/series'),
  healthChecks: () => get<HealthChecks>('/api/publishing/health-checks'),
  freshness: () => get<Freshness>('/api/publishing/freshness'),
  releaseWindow: (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v) qs.set(k, v)
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return get<ReleaseWindowResponse>(`/api/publishing/releases${suffix}`)
  },
}

// Formatting helpers shared across views.

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}

export function formatCompact(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// Safe date parsing: returns a valid Date or null. Handles both ISO strings
// (with timezone) and bare SQLite "YYYY-MM-DD HH:MM:SS" local strings.
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

export function formatDate(utc: string | null | undefined): string {
  const d = parseDate(utc)
  if (!d) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatLocalDate(local: string | null | undefined, fallbackUtc?: string | null): string {
  const value = local || fallbackUtc
  if (!value) return '—'
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return formatDate(fallbackUtc)
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatLocalTime(local: string | null | undefined): string {
  if (!local) return '—'
  const match = local.match(/\s(\d{2}):(\d{2})/)
  if (!match) return '—'
  const hour = Number(match[1])
  const minute = Number(match[2])
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function formatDateTime(utc: string | null | undefined): string {
  const d = parseDate(utc)
  if (!d) return '—'
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function relativeTime(utc: string | null | undefined): string {
  const d = parseDate(utc)
  if (!d) return '—'
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

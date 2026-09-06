import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Library,
  CalendarDays,
  BarChart3,
  Activity,
  BookOpen,
} from 'lucide-react'
import { api, type Health } from './api'
import Overview from './views/Overview'
import Catalog from './views/Catalog'
import Releases from './views/Releases'
import SeriesAnalytics from './views/SeriesAnalytics'
import DataHealth from './views/DataHealth'

type Tab = 'overview' | 'catalog' | 'releases' | 'series' | 'health'

const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'catalog', label: 'Catalog', icon: Library },
  { id: 'releases', label: 'Releases', icon: CalendarDays },
  { id: 'series', label: 'Series', icon: BarChart3 },
  { id: 'health', label: 'Data Health', icon: Activity },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('overview')
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState(false)

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => {
        setHealth(null)
        setHealthError(true)
      })
  }, [])

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <span className="brand-mark">
              <BookOpen size={20} strokeWidth={1.75} />
            </span>
            <div className="brand-text">
              <h1>Xanmal Publishing</h1>
              <p>Editorial Dashboard</p>
            </div>
          </div>
          <div className="masthead-meta">
            {health ? (
              <span className="freshness-pill">
                <span className="dot" />
                {health.path ? health.path.split('/').pop() : 'connected'}
              </span>
            ) : (
              <span className="freshness-pill offline">
                <span className="dot" />
                {healthError ? 'API unavailable' : 'Connecting…'}
              </span>
            )}
          </div>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Dashboard sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              const idx = TABS.findIndex((t) => t.id === tab)
              let next: number | null = null
              if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length
              else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length
              if (next !== null) {
                e.preventDefault()
                setTab(TABS[next].id)
                document.getElementById(`tab-${TABS[next].id}`)?.focus()
              }
            }}
          >
            <Icon size={16} strokeWidth={1.75} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {TABS.map(({ id }) => (
          <div
            key={id}
            role="tabpanel"
            id={`panel-${id}`}
            aria-labelledby={`tab-${id}`}
            hidden={tab !== id}
          >
            {tab === 'overview' && <Overview />}
            {tab === 'catalog' && <Catalog />}
            {tab === 'releases' && <Releases />}
            {tab === 'series' && <SeriesAnalytics />}
            {tab === 'health' && <DataHealth />}
          </div>
        ))}
      </main>

      <footer className="footer">
        <span>Xanmal Chronicles · read-only dashboard</span>
        <span>SQLite · React · served from /publishing/</span>
      </footer>
    </div>
  )
}

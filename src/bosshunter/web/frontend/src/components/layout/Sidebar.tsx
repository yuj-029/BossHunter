import { NavLink } from 'react-router-dom'
import { Github, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NAV_ITEMS } from './navigation'

const GITHUB_URL = 'https://github.com/powerycy/BossHunter'

interface SidebarProps {
  pendingReplies?: number
  mobileOpen?: boolean
  onNavigate?: () => void
}

export function Sidebar({ pendingReplies: pendingRepliesProp, mobileOpen = false, onNavigate }: SidebarProps) {
  const [pendingReplies, setPendingReplies] = useState(pendingRepliesProp ?? 0)

  useEffect(() => {
    if (pendingRepliesProp !== undefined) {
      setPendingReplies(pendingRepliesProp)
      return
    }

    const fetchPendingReplies = async () => {
      try {
        const res = await fetch('/api/history/unresolved-replies/count')
        const data = await res.json()
        setPendingReplies(Number(data.count) || 0)
      } catch {
        setPendingReplies(0)
      }
    }

    fetchPendingReplies()
    const interval = setInterval(fetchPendingReplies, 30000)
    return () => clearInterval(interval)
  }, [pendingRepliesProp])

  return (
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col border-r border-card-border bg-white transition-transform lg:static lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="h-16 flex items-center px-5 border-b border-card-border">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/20">
            <span className="font-black text-sm">BH</span>
          </div>
          <div>
            <div className="font-black text-sm tracking-tight text-foreground">BossHunter</div>
            <div className="text-[11px] text-muted">v2.3.2 · 本地控制台</div>
          </div>
        </div>
        <button type="button" className="ml-2 rounded-lg p-2 text-muted hover:bg-surface-accent hover:text-primary lg:hidden" onClick={onNavigate} aria-label="关闭导航">
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center justify-between gap-3 px-3 py-3 rounded-xl text-sm transition-colors ${
                isActive
                  ? 'bg-surface-accent text-primary font-black'
                  : 'text-muted hover:text-foreground hover:bg-surface-subtle'
              }`
            }
          >
            <span className="flex items-center gap-3">
              <item.icon className="w-4 h-4" />
              {item.label}
            </span>
            {item.to === '/monitor' && pendingReplies > 0 && (
              <span className="h-2 w-2 rounded-full bg-danger" aria-label="有待处理事项" />
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-card-border space-y-3">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="relative flex items-center rounded-2xl border border-card-border bg-surface-subtle px-3 py-3 text-xs font-black text-foreground transition-colors hover:border-primary/60 hover:text-primary"
        >
          <Github className="absolute left-3 h-4 w-4" />
          <span className="mx-auto flex items-center justify-center gap-2">
            <span className="text-xl leading-none text-yellow-400">★</span>
            BossHunter
          </span>
        </a>
        <p className="text-center text-[11px] leading-5 text-muted">❤️  欢迎点 Star 支持维护  ❤️</p>
      </div>
    </aside>
  )
}

import { useLocation } from 'react-router-dom'
import { Activity, AlertCircle, LoaderCircle, Menu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getPageTitle } from './navigation'

interface HeaderProps {
  onOpenNavigation: () => void
}

type HealthStatus = 'checking' | 'online' | 'offline'

export function Header({ onOpenNavigation }: HeaderProps) {
  const location = useLocation()
  const title = getPageTitle(location.pathname)
  const [health, setHealth] = useState<HealthStatus>('checking')

  useEffect(() => {
    let active = true
    const checkHealth = async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (active) setHealth(response.ok && data.status === 'ok' ? 'online' : 'offline')
      } catch {
        if (active) setHealth('offline')
      }
    }

    void checkHealth()
    const interval = window.setInterval(checkHealth, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-card-border bg-surface-subtle px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-card-border bg-white text-foreground lg:hidden"
          onClick={onOpenNavigation}
          aria-label="打开导航"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="truncate text-sm font-black text-foreground">
          <span className="hidden lg:inline">BossHunter 求职管理台</span>
          <span className="lg:hidden">{title}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs">
        {health === 'checking' && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-muted" />}
        {health === 'online' && <Activity className="h-3.5 w-3.5 text-success" />}
        {health === 'offline' && <AlertCircle className="h-3.5 w-3.5 text-danger" />}
        <span className={health === 'offline' ? 'font-bold text-danger' : 'text-muted'}>
          {health === 'checking' ? '正在检测服务' : health === 'online' ? '本地服务运行中' : '本地服务连接异常'}
        </span>
      </div>
    </header>
  )
}

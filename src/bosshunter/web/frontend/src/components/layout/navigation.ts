import { BriefcaseBusiness, LayoutDashboard, Radar, Settings, type LucideIcon } from 'lucide-react'

export interface NavigationItem {
  to: string
  icon: LucideIcon
  label: string
}

export const NAV_ITEMS: NavigationItem[] = [
  { to: '/', icon: LayoutDashboard, label: '工作台' },
  { to: '/jobs', icon: BriefcaseBusiness, label: '岗位池' },
  { to: '/monitor', icon: Radar, label: '监测执行' },
  { to: '/config', icon: Settings, label: '配置' },
]

export function getPageTitle(pathname: string) {
  return NAV_ITEMS.find(item => item.to === '/'
    ? pathname === '/'
    : pathname === item.to || pathname.startsWith(`${item.to}/`))?.label || 'BossHunter'
}

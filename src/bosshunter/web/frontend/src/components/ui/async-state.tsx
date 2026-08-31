import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageSkeleton({ label = '正在加载页面...' }: { label?: string }) {
  return (
    <div className="space-y-4" aria-live="polite" aria-busy="true">
      <div className="h-16 animate-pulse rounded-2xl border border-card-border bg-white/70" />
      <div className="min-h-[320px] animate-pulse rounded-2xl border border-card-border bg-white/70 p-5">
        <span className="text-sm font-bold text-muted">{label}</span>
      </div>
    </div>
  )
}

export function EmptyState({ title, description, action, className }: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-card-border bg-surface-subtle p-6 text-center', className)}>
      <div className="text-sm font-black text-foreground">{title}</div>
      {description && <p className="mt-1 max-w-xl text-xs leading-5 text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

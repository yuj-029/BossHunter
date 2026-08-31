import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  eyebrow?: string
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-black tracking-[0.16em] text-primary">{eyebrow}</div>}
        <h1 className={cn('text-2xl font-black tracking-tight text-foreground', eyebrow && 'mt-1')}>{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

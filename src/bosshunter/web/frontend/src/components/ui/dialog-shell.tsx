import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function DialogShell({ children, className, label }: {
  children: ReactNode
  className?: string
  label: string
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label={label}>
      <div className={cn('max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-card-border bg-white p-5 shadow-2xl sm:p-6', className)}>
        {children}
      </div>
    </div>
  )
}

import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { HTMLAttributes } from 'react'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border',
  {
    variants: {
      variant: {
        default: 'border-card-border bg-surface-subtle text-muted',
        pending: 'border-card-border bg-surface-subtle text-muted',
        scored: 'bg-blue-600/10 text-blue-600 border-blue-600/20',
        ready: 'bg-cyan-600/10 text-cyan-700 border-cyan-600/20',
        approved: 'bg-amber-600/10 text-amber-700 border-amber-600/20',
        skipped: 'border-card-border bg-surface-subtle text-muted',
        sent: 'bg-green-600/10 text-green-700 border-green-600/20',
        replied: 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20',
        resume_sent: 'bg-purple-600/10 text-purple-700 border-purple-600/20',
        needs_resume: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
        follow_up_sent: 'bg-sky-600/10 text-sky-700 border-sky-600/20',
        reply_pending: 'bg-amber-600/10 text-amber-700 border-amber-600/20',
        auto_replied: 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20',
        rejected: 'bg-red-600/10 text-red-700 border-red-600/20',
        error: 'bg-red-600/10 text-red-700 border-red-600/20',
        filtered: 'border-card-border bg-surface-subtle text-muted',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

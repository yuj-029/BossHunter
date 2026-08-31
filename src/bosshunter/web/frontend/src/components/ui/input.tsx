import { cn } from '@/lib/utils'
import { forwardRef, InputHTMLAttributes } from 'react'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-xl border border-card-border bg-white px-3 py-1 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted',
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
Input.displayName = 'Input'

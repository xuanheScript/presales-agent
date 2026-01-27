'use client'

import { cn } from '@/lib/utils'
import type { ChatMode } from '@/types'

interface ModeToggleProps {
  mode: ChatMode
  onChange: (mode: ChatMode) => void
  disabled?: boolean
}

export function ModeToggle({ mode, onChange, disabled }: ModeToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted p-1">
      <button
        type="button"
        className={cn(
          'px-3 py-1.5 text-sm font-medium rounded-md transition-all',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          mode === 'internal'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onClick={() => onChange('internal')}
        disabled={disabled}
      >
        <span className="flex items-center gap-1.5">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          快速分析
        </span>
      </button>
      <button
        type="button"
        className={cn(
          'px-3 py-1.5 text-sm font-medium rounded-md transition-all',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          mode === 'elicitation'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onClick={() => onChange('elicitation')}
        disabled={disabled}
      >
        <span className="flex items-center gap-1.5">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          引导模式
        </span>
      </button>
    </div>
  )
}

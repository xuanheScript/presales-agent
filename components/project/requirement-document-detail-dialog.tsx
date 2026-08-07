'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Copy, Search } from 'lucide-react'
import { toast } from 'sonner'
import { ApplyRequirementSourceButton } from '@/components/project/apply-requirement-source-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  highlightLiteralText,
  type HighlightTextSegment,
} from '@/lib/requirements/highlight-text'
import type { RequirementSourceStatus } from '@/lib/requirements/workbench'
import { cn } from '@/lib/utils'

const statusTone: Record<RequirementSourceStatus, string> = {
  draft: 'border-amber-200 bg-amber-50/70 text-amber-800',
  processing: 'border-sky-200 bg-sky-50/70 text-sky-800',
  review_required: 'border-orange-200 bg-orange-50/70 text-orange-800',
  pending_changes: 'border-rose-200 bg-rose-50/70 text-rose-800',
  included: 'border-emerald-200 bg-emerald-50/70 text-emerald-800',
  failed: 'border-red-200 bg-red-50/70 text-red-800',
}

interface RequirementDocumentDetailDialogProps {
  trigger: ReactNode
  projectId: string
  requirementId: string
  expectedBaselineId: string | null
  title: string
  content: string
  status: RequirementSourceStatus
  statusLabel: string
  createdAtLabel: string
  canApply: boolean
}

export function RequirementDocumentDetailDialog({
  trigger,
  projectId,
  requirementId,
  expectedBaselineId,
  title,
  content,
  status,
  statusLabel,
  createdAtLabel,
  canApply,
}: RequirementDocumentDetailDialogProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const segments = useMemo(
    () => highlightLiteralText(content, query),
    [content, query],
  )
  const matchCount = query.trim()
    ? segments.filter((segment) => segment.highlighted).length
    : 0

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(content)
      toast.success('文档正文已复制')
    } catch {
      toast.error('复制失败，请检查浏览器剪贴板权限')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex w-full min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={`查看${title}详情`}
        >
          {trigger}
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{title}</DialogTitle>
            <Badge variant="outline" className={statusTone[status]}>
              {statusLabel}
            </Badge>
          </div>
          <DialogDescription>
            创建于 {createdAtLabel}。以下内容是系统提取的纯文本，不代表 PDF 或 DOCX 的原始版式。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 border-b bg-muted/20 px-6 py-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索提取正文"
              aria-label="搜索文档正文"
              autoComplete="off"
              className="pl-9 pr-20"
            />
            {query.trim() ? (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground">
                {matchCount} 处匹配
              </span>
            ) : null}
          </div>
          <Button type="button" variant="outline" onClick={() => void copyContent()}>
            <Copy className="h-4 w-4" />复制全文
          </Button>
        </div>

        <div className="min-h-0 flex-1 bg-muted/10 p-6">
          <ScrollArea className="h-[55vh] min-h-64 rounded-lg border bg-background">
            <div className="whitespace-pre-wrap wrap-break-word p-5 text-sm leading-7">
              {segments.length > 0
                ? segments.map((segment, index) => (
                    <TextSegment key={`${index}-${segment.text.length}`} segment={segment} />
                  ))
                : <span className="text-muted-foreground">未提取到文档正文。</span>}
            </div>
          </ScrollArea>
        </div>

        {canApply ? (
          <DialogFooter className="border-t bg-background px-6 py-4">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-left text-xs text-muted-foreground">
                确认后将生成新的正式需求版本，历史版本仍会保留。
              </p>
              <ApplyRequirementSourceButton
                projectId={projectId}
                requirementId={requirementId}
                expectedBaselineId={expectedBaselineId}
                onApplied={() => setOpen(false)}
              />
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function TextSegment({ segment }: { segment: HighlightTextSegment }) {
  if (!segment.highlighted) return segment.text

  return (
    <mark className={cn('rounded-sm bg-amber-200 px-0.5 text-foreground dark:bg-amber-500/35')}>
      {segment.text}
    </mark>
  )
}

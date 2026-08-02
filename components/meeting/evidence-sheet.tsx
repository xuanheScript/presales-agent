'use client'

import { FileText, Play } from 'lucide-react'
import type { MeetingAnalysisItem } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatMeetingTimestamp } from '@/components/meeting/meeting-audio-player'
import { cn } from '@/lib/utils'

export function EvidenceSheet({
  item,
  open,
  activeSegmentId,
  onOpenChange,
  onSeek,
}: {
  item: MeetingAnalysisItem | null
  open: boolean
  activeSegmentId: string | null
  onOpenChange: (open: boolean) => void
  onSeek: (segmentId: string, startMs: number) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-8">
            <FileText className="h-5 w-5" />原文证据
          </SheetTitle>
          <SheetDescription>
            {item ? `“${item.title}”引用了 ${item.evidence.length} 个已批准转写片段。` : '查看已批准转写稿中的证据。'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {item?.evidence.map((evidence) => (
            <div
              key={evidence.transcript_segment_id}
              className={cn(
                'space-y-3 rounded-lg border p-4 transition-colors',
                activeSegmentId === evidence.transcript_segment_id && 'border-primary bg-primary/5',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {evidence.segment.speaker_key || '未标记说话人'}
                  <span className="ml-2 font-normal text-muted-foreground">
                    片段 {evidence.segment.sequence_no}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onSeek(
                    evidence.transcript_segment_id,
                    evidence.segment.start_ms,
                  )}
                >
                  <Play className="h-3.5 w-3.5" />
                  {formatMeetingTimestamp(evidence.segment.start_ms)}–{formatMeetingTimestamp(evidence.segment.end_ms)}
                </Button>
              </div>
              <blockquote className="border-l-2 pl-3 text-sm leading-6 text-muted-foreground">
                {evidence.segment.text}
              </blockquote>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

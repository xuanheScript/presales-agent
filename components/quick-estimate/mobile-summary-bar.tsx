'use client'

import { ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { useState } from 'react'
import { EstimateSummary } from './estimate-summary'
import type { FunctionLibraryItem, QuickEstimateItem } from '@/types'

interface MobileSummaryBarProps {
  selectedItems: Map<string, QuickEstimateItem>
  functionLibraryMap: Map<string, FunctionLibraryItem>
  bufferCoefficient: number
  laborCostPerDay: number
  onBufferChange: (value: number) => void
  onLaborCostChange: (value: number) => void
  onUpdateFactors: (id: string, selectedFactors: string[]) => void
  onRemove: (id: string) => void
  summary: {
    count: number
    totalHours: number
    totalAdjustedHours: number
    totalDays: number
    bufferedDays: number
    totalCost: number
  }
}

export function MobileSummaryBar({
  selectedItems,
  functionLibraryMap,
  bufferCoefficient,
  laborCostPerDay,
  onBufferChange,
  onLaborCostChange,
  onUpdateFactors,
  onRemove,
  summary,
}: MobileSummaryBarProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* 底部悬浮栏 */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background p-3 lg:hidden">
        <div className="flex items-center justify-between">
          <div className="text-sm">
            <span className="text-muted-foreground">已选 </span>
            <span className="font-semibold">{summary.count}</span>
            <span className="text-muted-foreground"> 项</span>
            {summary.count > 0 && (
              <>
                <span className="mx-1.5 text-muted-foreground">·</span>
                <span className="font-semibold">{summary.bufferedDays}</span>
                <span className="text-muted-foreground"> 人天</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {summary.count > 0 && (
              <span className="text-lg font-bold text-primary">
                ¥{summary.totalCost.toLocaleString('zh-CN')}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              disabled={summary.count === 0}
            >
              详情
              <ChevronUp className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* 底部滑出的详情面板 */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>估算详情</SheetTitle>
            <SheetDescription>查看和调整估算参数</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <EstimateSummary
              selectedItems={selectedItems}
              functionLibraryMap={functionLibraryMap}
              bufferCoefficient={bufferCoefficient}
              laborCostPerDay={laborCostPerDay}
              onBufferChange={onBufferChange}
              onLaborCostChange={onLaborCostChange}
              onUpdateFactors={onUpdateFactors}
              onRemove={onRemove}
              summary={summary}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

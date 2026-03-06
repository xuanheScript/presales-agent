'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { X, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { FunctionLibraryItem, QuickEstimateItem } from '@/types'
import { DEFAULT_CONFIG } from '@/constants'

interface EstimateSummaryProps {
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

export function EstimateSummary({
  selectedItems,
  functionLibraryMap,
  bufferCoefficient,
  laborCostPerDay,
  onBufferChange,
  onLaborCostChange,
  onUpdateFactors,
  onRemove,
  summary,
}: EstimateSummaryProps) {
  return (
    <div className="space-y-4">
      {/* 汇总卡片 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">估算汇总</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">已选功能</span>
              <p className="text-lg font-semibold">{summary.count} 个</p>
            </div>
            <div>
              <span className="text-muted-foreground">基础总工时</span>
              <p className="text-lg font-semibold">{summary.totalHours} 小时</p>
            </div>
            <div>
              <span className="text-muted-foreground">调整后工时</span>
              <p className="text-lg font-semibold">{summary.totalAdjustedHours} 小时</p>
            </div>
            <div>
              <span className="text-muted-foreground">基础人天</span>
              <p className="text-lg font-semibold">{summary.totalDays} 天</p>
            </div>
          </div>

          <Separator />

          {/* 参数调整 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="buffer" className="text-xs">缓冲系数</Label>
              <Input
                id="buffer"
                type="number"
                min={1.0}
                max={2.5}
                step={0.1}
                value={bufferCoefficient}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (!isNaN(val) && val >= 1.0 && val <= 2.5) {
                    onBufferChange(val)
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="laborCost" className="text-xs">人天单价 (元)</Label>
              <Input
                id="laborCost"
                type="number"
                min={0}
                step={100}
                value={laborCostPerDay}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (!isNaN(val) && val >= 0) {
                    onLaborCostChange(val)
                  }
                }}
              />
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            缓冲后人天: <span className="font-medium text-foreground">{summary.bufferedDays} 天</span>
          </div>

          <Separator />

          {/* 总成本 */}
          <div className="text-center">
            <span className="text-sm text-muted-foreground">预估总成本</span>
            <p className="text-2xl font-bold text-primary">
              ¥{summary.totalCost.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 已选功能明细 */}
      {summary.count > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">已选功能明细</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Array.from(selectedItems.entries()).map(([id, item]) => (
                <SelectedItemCard
                  key={id}
                  item={item}
                  libraryItem={functionLibraryMap.get(id)}
                  onUpdateFactors={(factors) => onUpdateFactors(id, factors)}
                  onRemove={() => onRemove(id)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SelectedItemCard({
  item,
  libraryItem,
  onUpdateFactors,
  onRemove,
}: {
  item: QuickEstimateItem
  libraryItem?: FunctionLibraryItem
  onUpdateFactors: (factors: string[]) => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const factors = libraryItem?.complexity_factors || {}
  const hasFactors = Object.keys(factors).length > 0

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{item.function_name}</span>
            <Badge variant="outline" className="shrink-0 text-xs">{item.category}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span>基础: {item.standard_hours}h</span>
            {item.complexity_multiplier !== 1 && (
              <span>系数: ×{item.complexity_multiplier.toFixed(1)}</span>
            )}
            <span className="font-medium text-foreground">
              调整后: {item.adjusted_hours}h
            </span>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onRemove}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 复杂度因子 */}
      {hasFactors && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            复杂度调整
          </button>
          {expanded && (
            <div className="space-y-1.5 pl-1">
              {Object.entries(factors).map(([key, multiplier]) => (
                <label key={key} className="flex items-center gap-2 min-h-[36px] cursor-pointer">
                  <Checkbox
                    checked={item.selected_factors.includes(key)}
                    onCheckedChange={(checked) => {
                      const newFactors = checked
                        ? [...item.selected_factors, key]
                        : item.selected_factors.filter((f) => f !== key)
                      onUpdateFactors(newFactors)
                    }}
                  />
                  <span className="text-xs">{key}</span>
                  <Badge variant="secondary" className="text-xs ml-auto">
                    ×{multiplier}
                  </Badge>
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

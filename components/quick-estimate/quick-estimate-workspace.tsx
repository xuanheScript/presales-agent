'use client'

import { useCallback, useMemo, useState } from 'react'
import { FunctionSelector } from './function-selector'
import { EstimateSummary } from './estimate-summary'
import { MobileSummaryBar } from './mobile-summary-bar'
import { SaveEstimateDialog } from './save-estimate-dialog'
import { DEFAULT_CONFIG } from '@/constants'
import type { FunctionLibraryItem, FunctionGroupWithItems, QuickEstimateItem } from '@/types'
import { toast } from 'sonner'

interface QuickEstimateWorkspaceProps {
  items: FunctionLibraryItem[]
  groups: FunctionGroupWithItems[]
  defaultLaborCostPerDay: number
}

export function QuickEstimateWorkspace({
  items,
  groups,
  defaultLaborCostPerDay,
}: QuickEstimateWorkspaceProps) {
  const [selectedItems, setSelectedItems] = useState<Map<string, QuickEstimateItem>>(new Map())
  const [bufferCoefficient, setBufferCoefficient] = useState(1.3)
  const [laborCostPerDay, setLaborCostPerDay] = useState(defaultLaborCostPerDay)

  // 功能库数据 Map，用于查 complexity_factors
  const functionLibraryMap = useMemo(() => {
    const map = new Map<string, FunctionLibraryItem>()
    for (const item of items) {
      map.set(item.id, item)
    }
    return map
  }, [items])

  // 已选 ID 集合
  const selectedIds = useMemo(() => new Set(selectedItems.keys()), [selectedItems])

  // 切换选中
  const handleToggle = useCallback((item: FunctionLibraryItem) => {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      if (next.has(item.id)) {
        next.delete(item.id)
      } else {
        next.set(item.id, {
          function_library_id: item.id,
          function_name: item.function_name,
          category: item.category,
          standard_hours: item.standard_hours,
          selected_factors: [],
          complexity_multiplier: 1,
          adjusted_hours: item.standard_hours,
        })
      }
      return next
    })
  }, [])

  // 更新复杂度因子
  const handleUpdateFactors = useCallback(
    (id: string, selectedFactors: string[]) => {
      setSelectedItems((prev) => {
        const next = new Map(prev)
        const item = next.get(id)
        if (!item) return prev

        const libraryItem = functionLibraryMap.get(id)
        const factors = libraryItem?.complexity_factors || {}

        // 计算复杂度系数 = 选中因子值的乘积
        const multiplier = selectedFactors.reduce((acc, key) => {
          return acc * (factors[key] || 1)
        }, 1)

        next.set(id, {
          ...item,
          selected_factors: selectedFactors,
          complexity_multiplier: Math.round(multiplier * 100) / 100,
          adjusted_hours: Math.round(item.standard_hours * multiplier * 100) / 100,
        })
        return next
      })
    },
    [functionLibraryMap]
  )

  // 移除
  const handleRemove = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  // 按组添加
  const handleAddGroup = useCallback((group: FunctionGroupWithItems) => {
    let addedCount = 0
    let skippedCount = 0

    setSelectedItems((prev) => {
      const next = new Map(prev)
      for (const groupItem of group.items) {
        if (next.has(groupItem.function_library_id)) {
          skippedCount++
          continue
        }
        next.set(groupItem.function_library_id, {
          function_library_id: groupItem.function_library_id,
          function_name: groupItem.function_name,
          category: groupItem.category,
          standard_hours: groupItem.standard_hours,
          selected_factors: [],
          complexity_multiplier: 1,
          adjusted_hours: groupItem.standard_hours,
        })
        addedCount++
      }
      return next
    })

    setTimeout(() => {
      if (skippedCount > 0 && addedCount > 0) {
        toast.info(`已添加 ${addedCount} 个功能，${skippedCount} 个已存在已跳过`)
      } else if (addedCount > 0) {
        toast.success(`已从「${group.name}」添加 ${addedCount} 个功能`)
      } else {
        toast.info('组内所有功能已在列表中')
      }
    }, 0)
  }, [])

  // 实时汇总计算
  const summary = useMemo(() => {
    const entries = Array.from(selectedItems.values())
    const totalHours = entries.reduce((sum, item) => sum + item.standard_hours, 0)
    const totalAdjustedHours = entries.reduce((sum, item) => sum + item.adjusted_hours, 0)
    const totalDays = Math.round((totalAdjustedHours / DEFAULT_CONFIG.WORKING_HOURS_PER_DAY) * 10) / 10
    const bufferedDays = Math.round(totalDays * bufferCoefficient * 10) / 10
    const totalCost = Math.round(bufferedDays * laborCostPerDay)

    return {
      count: entries.length,
      totalHours: Math.round(totalHours * 10) / 10,
      totalAdjustedHours: Math.round(totalAdjustedHours * 10) / 10,
      totalDays,
      bufferedDays,
      totalCost,
    }
  }, [selectedItems, bufferCoefficient, laborCostPerDay])

  const summaryProps = {
    selectedItems,
    functionLibraryMap,
    bufferCoefficient,
    laborCostPerDay,
    onBufferChange: setBufferCoefficient,
    onLaborCostChange: setLaborCostPerDay,
    onUpdateFactors: handleUpdateFactors,
    onRemove: handleRemove,
    summary,
  }

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">快速估算</h1>
          <p className="text-sm text-muted-foreground">从功能库选择模块，快速生成预估报价</p>
        </div>
        <SaveEstimateDialog
          selectedItems={Array.from(selectedItems.values())}
          totalHours={summary.totalHours}
          totalAdjustedHours={summary.totalAdjustedHours}
          bufferCoefficient={bufferCoefficient}
          laborCostPerDay={laborCostPerDay}
          totalCost={summary.totalCost}
          disabled={summary.count === 0}
        />
      </div>

      {/* 响应式主内容区 */}
      <div className="lg:grid lg:grid-cols-[1fr_420px] lg:gap-6">
        {/* 左侧：功能选择 */}
        <div>
          <FunctionSelector
            items={items}
            groups={groups}
            selectedIds={selectedIds}
            onToggle={handleToggle}
            onAddGroup={handleAddGroup}
          />
        </div>

        {/* 右侧：汇总面板（桌面端） */}
        <div className="hidden lg:block">
          <div className="sticky top-4">
            <EstimateSummary {...summaryProps} />
          </div>
        </div>
      </div>

      {/* 移动端底部悬浮栏 */}
      <MobileSummaryBar {...summaryProps} />
    </div>
  )
}

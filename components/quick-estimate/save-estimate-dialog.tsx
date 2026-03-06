'use client'

import { useState } from 'react'
import { Save } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { saveQuickEstimate } from '@/app/actions/quick-estimate'
import type { QuickEstimateItem } from '@/types'

interface SaveEstimateDialogProps {
  selectedItems: QuickEstimateItem[]
  totalHours: number
  totalAdjustedHours: number
  bufferCoefficient: number
  laborCostPerDay: number
  totalCost: number
  disabled?: boolean
}

export function SaveEstimateDialog({
  selectedItems,
  totalHours,
  totalAdjustedHours,
  bufferCoefficient,
  laborCostPerDay,
  totalCost,
  disabled,
}: SaveEstimateDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('请输入估算名称')
      return
    }

    setSaving(true)
    try {
      const result = await saveQuickEstimate({
        name: name.trim(),
        description: description.trim() || undefined,
        selected_items: selectedItems,
        total_hours: totalHours,
        total_adjusted_hours: totalAdjustedHours,
        buffer_coefficient: bufferCoefficient,
        labor_cost_per_day: laborCostPerDay,
        total_cost: totalCost,
      })

      if (result.success) {
        toast.success('估算已保存')
        setOpen(false)
        setName('')
        setDescription('')
      } else {
        toast.error(result.error || '保存失败')
      }
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Save className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">保存估算</span>
          <span className="sm:hidden">保存</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>保存快速估算</DialogTitle>
          <DialogDescription>
            保存当前估算结果，方便后续查看和对比。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="estimate-name">估算名称 *</Label>
            <Input
              id="estimate-name"
              placeholder="如：XX项目初步报价"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="estimate-desc">备注</Label>
            <Textarea
              id="estimate-desc"
              placeholder="可选填写备注信息..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">功能数量</span>
              <span>{selectedItems.length} 个</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">预估总成本</span>
              <span className="font-semibold text-primary">
                ¥{totalCost.toLocaleString('zh-CN')}
              </span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

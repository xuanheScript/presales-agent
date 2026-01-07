'use client'

import { useState, useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Save } from 'lucide-react'
import { createFunctionLibraryItem, updateFunctionLibraryItem } from '@/app/actions/function-library'
import { FUNCTION_CATEGORIES } from '@/constants'
import type { FunctionLibraryItem } from '@/types'
import { toast } from 'sonner'

interface FunctionLibraryDialogProps {
  children: React.ReactNode
  item?: FunctionLibraryItem
  isEdit?: boolean
}

interface FormState {
  success: boolean
  error?: string
  id?: string
}

export function FunctionLibraryDialog({
  children,
  item,
  isEdit = false,
}: FunctionLibraryDialogProps) {
  const [open, setOpen] = useState(false)

  const handleSubmit = async (
    _prevState: FormState,
    formData: FormData
  ): Promise<FormState> => {
    let result: FormState

    if (isEdit && item) {
      result = await updateFunctionLibraryItem(item.id, formData)
    } else {
      result = await createFunctionLibraryItem(formData)
    }

    if (result.success) {
      toast.success(isEdit ? '功能已更新' : '功能创建成功')
      setOpen(false)
    } else if (result.error) {
      toast.error(result.error)
    }

    return result
  }

  const [state, formAction, isPending] = useActionState(handleSubmit, {
    success: false,
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑功能' : '新建功能'}</DialogTitle>
          <DialogDescription>
            {isEdit ? '修改功能库项目信息' : '添加新的标准功能到功能库'}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {/* 功能名称 */}
          <div className="space-y-2">
            <Label htmlFor="function_name">功能名称 *</Label>
            <Input
              id="function_name"
              name="function_name"
              defaultValue={item?.function_name}
              placeholder="例如：用户登录"
              required
            />
          </div>

          {/* 分类 */}
          <div className="space-y-2">
            <Label htmlFor="category">分类 *</Label>
            <Select name="category" defaultValue={item?.category} required>
              <SelectTrigger>
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                {FUNCTION_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 描述 */}
          <div className="space-y-2">
            <Label htmlFor="description">描述</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={item?.description || ''}
              placeholder="功能的简要描述..."
              className="min-h-[80px]"
            />
          </div>

          {/* 标准工时 */}
          <div className="space-y-2">
            <Label htmlFor="standard_hours">标准工时（小时）*</Label>
            <Input
              id="standard_hours"
              name="standard_hours"
              type="number"
              min="0.5"
              step="0.5"
              defaultValue={item?.standard_hours || ''}
              placeholder="例如：8"
              required
            />
            <p className="text-xs text-muted-foreground">
              基于中等难度的标准开发工时
            </p>
          </div>

          {/* 参考成本 */}
          <div className="space-y-2">
            <Label htmlFor="reference_cost">参考成本（元）</Label>
            <Input
              id="reference_cost"
              name="reference_cost"
              type="number"
              min="0"
              defaultValue={item?.reference_cost || ''}
              placeholder="可选"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  保存
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

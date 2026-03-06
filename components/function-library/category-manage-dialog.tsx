'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Settings, Plus, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react'
import {
  createFunctionCategory,
  updateFunctionCategory,
  deleteFunctionCategory,
} from '@/app/actions/function-categories'
import type { FunctionCategory } from '@/types'
import { toast } from 'sonner'

interface CategoryManageDialogProps {
  categories: FunctionCategory[]
  usageCounts: Record<string, number>
}

export function CategoryManageDialog({
  categories: initialCategories,
  usageCounts,
}: CategoryManageDialogProps) {
  const [open, setOpen] = useState(false)
  const [categories, setCategories] = useState(initialCategories)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isPending, startTransition] = useTransition()

  // 同步外部 props
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      setCategories(initialCategories)
      setEditingId(null)
      setNewName('')
    }
  }

  const handleCreate = () => {
    if (!newName.trim()) return
    startTransition(async () => {
      const result = await createFunctionCategory(newName)
      if (result.success) {
        toast.success('分类创建成功')
        setNewName('')
        // 乐观更新：添加到列表末尾
        setCategories((prev) => [
          ...prev,
          {
            id: result.id!,
            name: newName.trim(),
            sort_order: prev.length + 1,
            is_preset: false,
            created_by: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
      } else {
        toast.error(result.error || '创建失败')
      }
    })
  }

  const handleStartEdit = (category: FunctionCategory) => {
    setEditingId(category.id)
    setEditingName(category.name)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditingName('')
  }

  const handleSaveEdit = (id: string) => {
    if (!editingName.trim()) return
    startTransition(async () => {
      const result = await updateFunctionCategory(id, editingName)
      if (result.success) {
        toast.success('分类已更新')
        setCategories((prev) =>
          prev.map((c) => (c.id === id ? { ...c, name: editingName.trim() } : c))
        )
        setEditingId(null)
        setEditingName('')
      } else {
        toast.error(result.error || '更新失败')
      }
    })
  }

  const handleDelete = (category: FunctionCategory) => {
    const count = usageCounts[category.name] || 0
    if (count > 0) {
      toast.error(`该分类下有 ${count} 个功能，请先将这些功能移到其他分类后再删除`)
      return
    }
    if (!confirm(`确定要删除分类"${category.name}"吗？`)) return
    startTransition(async () => {
      const result = await deleteFunctionCategory(category.id)
      if (result.success) {
        toast.success('分类已删除')
        setCategories((prev) => prev.filter((c) => c.id !== category.id))
      } else {
        toast.error(result.error || '删除失败')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="管理分类">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>管理功能分类</DialogTitle>
          <DialogDescription>
            管理功能库使用的分类标签，预制分类不可修改或删除
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
          {categories.map((category) => (
            <div
              key={category.id}
              className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group"
            >
              {editingId === category.id ? (
                <>
                  <Input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(category.id)
                      if (e.key === 'Escape') handleCancelEdit()
                    }}
                    className="h-8 flex-1"
                    autoFocus
                    disabled={isPending}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => handleSaveEdit(category.id)}
                    disabled={isPending}
                  >
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={handleCancelEdit}
                    disabled={isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{category.name}</span>
                  {category.is_preset && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      预制
                    </Badge>
                  )}
                  {(usageCounts[category.name] || 0) > 0 && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {usageCounts[category.name]} 个功能
                    </span>
                  )}
                  {!category.is_preset && (
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleStartEdit(category)}
                        disabled={isPending}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-600 hover:text-red-700"
                        onClick={() => handleDelete(category)}
                        disabled={isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {/* 新建分类 */}
        <div className="flex gap-2 pt-2 border-t">
          <Input
            placeholder="输入新分类名称..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
            }}
            className="flex-1"
            disabled={isPending}
          />
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={isPending || !newName.trim()}
          >
            {isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-3.5 w-3.5" />
            )}
            添加
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

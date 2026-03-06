'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Loader2, Save, Search, ChevronDown, ChevronRight, X } from 'lucide-react'
import { createFunctionGroup, updateFunctionGroup } from '@/app/actions/function-groups'
import type { FunctionLibraryItem, FunctionGroup, FunctionGroupItemDetail } from '@/types'
import { toast } from 'sonner'

interface FunctionGroupDialogProps {
  children: React.ReactNode
  allFunctions: FunctionLibraryItem[]
  group?: FunctionGroup
  groupItems?: FunctionGroupItemDetail[]
  isEdit?: boolean
}

export function FunctionGroupDialog({
  children,
  allFunctions,
  group,
  groupItems,
  isEdit = false,
}: FunctionGroupDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(group?.name || '')
  const [description, setDescription] = useState(group?.description || '')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(groupItems?.map((item) => item.function_library_id) || [])
  )
  const [search, setSearch] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  // 对话框打开时重置状态
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      setName(group?.name || '')
      setDescription(group?.description || '')
      setSelectedIds(new Set(groupItems?.map((item) => item.function_library_id) || []))
      setSearch('')
      setIsPending(false)
      setCollapsedCategories(new Set())
    }
  }

  // 按分类分组的功能列表
  const groupedFunctions = useMemo(() => {
    const filtered = search
      ? allFunctions.filter(
          (f) =>
            f.function_name.toLowerCase().includes(search.toLowerCase()) ||
            f.description?.toLowerCase().includes(search.toLowerCase())
        )
      : allFunctions

    const groups: Record<string, FunctionLibraryItem[]> = {}
    for (const func of filtered) {
      if (!groups[func.category]) {
        groups[func.category] = []
      }
      groups[func.category].push(func)
    }
    return groups
  }, [allFunctions, search])

  // 已选功能列表
  const selectedFunctions = useMemo(() => {
    return allFunctions.filter((f) => selectedIds.has(f.id))
  }, [allFunctions, selectedIds])

  const totalHours = useMemo(() => {
    return selectedFunctions.reduce((sum, f) => sum + f.standard_hours, 0)
  }, [selectedFunctions])

  const toggleFunction = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('请输入组名称')
      return
    }
    if (selectedIds.size === 0) {
      toast.error('请至少选择一个功能')
      return
    }

    setIsPending(true)

    const input = {
      name: name.trim(),
      description: description.trim() || undefined,
      function_library_ids: Array.from(selectedIds),
    }

    let result: { success: boolean; error?: string }
    if (isEdit && group) {
      result = await updateFunctionGroup(group.id, input)
    } else {
      result = await createFunctionGroup(input)
    }

    setIsPending(false)

    if (result.success) {
      toast.success(isEdit ? '功能组已更新' : '功能组创建成功')
      setOpen(false)
    } else {
      toast.error(result.error || '操作失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[800px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑功能组' : '新建功能组'}</DialogTitle>
          <DialogDescription>
            {isEdit ? '修改功能组信息和包含的功能' : '创建一个新的功能组，将常用功能打包在一起'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-4">
          {/* 组基础信息 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="group_name">组名称 *</Label>
              <Input
                id="group_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：电商基础套餐"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group_desc">描述</Label>
              <Input
                id="group_desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="功能组的简要描述"
              />
            </div>
          </div>

          {/* 功能选择区域 */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-4 min-h-0 flex-1">
            {/* 左侧：功能列表 */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜索功能..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <ScrollArea className="h-[340px] rounded-md border p-2">
                <div className="space-y-1">
                  {Object.entries(groupedFunctions).map(([category, functions]) => {
                    const isCollapsed = collapsedCategories.has(category)
                    const selectedInCat = functions.filter((f) => selectedIds.has(f.id)).length

                    return (
                      <Collapsible
                        key={category}
                        open={!isCollapsed}
                        onOpenChange={() => toggleCategory(category)}
                      >
                        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted">
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span>{category}</span>
                          <Badge variant="secondary" className="text-xs">
                            {functions.length}
                          </Badge>
                          {selectedInCat > 0 && (
                            <Badge className="ml-auto text-xs">
                              {selectedInCat}
                            </Badge>
                          )}
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-0.5 pl-2">
                            {functions.map((func) => (
                              <label
                                key={func.id}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                              >
                                <Checkbox
                                  checked={selectedIds.has(func.id)}
                                  onCheckedChange={() => toggleFunction(func.id)}
                                />
                                <span className="text-sm truncate flex-1">
                                  {func.function_name}
                                </span>
                                <Badge variant="outline" className="shrink-0 text-xs tabular-nums">
                                  {func.standard_hours}h
                                </Badge>
                              </label>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )
                  })}
                  {Object.keys(groupedFunctions).length === 0 && (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      未找到匹配的功能
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* 右侧：已选摘要 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  已选 {selectedIds.size} 个功能
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {totalHours}h
                </span>
              </div>
              <ScrollArea className="h-[340px] rounded-md border p-2">
                <div className="space-y-1">
                  {selectedFunctions.map((func) => (
                    <div
                      key={func.id}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-muted group"
                    >
                      <span className="truncate flex-1">{func.function_name}</span>
                      <Badge variant="outline" className="shrink-0 text-xs tabular-nums">
                        {func.standard_hours}h
                      </Badge>
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => toggleFunction(func.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {selectedFunctions.length === 0 && (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      请从左侧选择功能
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
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
          <Button onClick={handleSubmit} disabled={isPending}>
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
      </DialogContent>
    </Dialog>
  )
}

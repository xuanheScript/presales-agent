'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Pencil, Trash2, Plus, Loader2, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  updateFunctionHours,
  updateFunctionDifficulty,
  deleteFunctionModule,
  addFunctionModule,
} from '@/app/actions/functions'
import { DIFFICULTY_MULTIPLIERS } from '@/constants'
import type { FunctionModule, DifficultyLevel } from '@/types'

interface FunctionTableProps {
  projectId: string
  functions: FunctionModule[]
}

const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  simple: '简单',
  medium: '中等',
  complex: '复杂',
  very_complex: '非常复杂',
}

const DIFFICULTY_COLORS: Record<DifficultyLevel, string> = {
  simple: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  complex: 'bg-orange-100 text-orange-800',
  very_complex: 'bg-red-100 text-red-800',
}

export function FunctionTable({ projectId, functions }: FunctionTableProps) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingHours, setEditingHours] = useState<number>(0)
  const [isPending, startTransition] = useTransition()
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

  // 新增功能表单状态
  const [newFunction, setNewFunction] = useState({
    moduleName: '',
    functionName: '',
    description: '',
    difficultyLevel: 'medium' as DifficultyLevel,
    estimatedHours: 8,
  })

  // 按模块分组
  const groupedFunctions = functions.reduce((acc, fn) => {
    if (!acc[fn.module_name]) {
      acc[fn.module_name] = []
    }
    acc[fn.module_name].push(fn)
    return acc
  }, {} as Record<string, FunctionModule[]>)

  // 计算总工时（应用难度系数）
  const totalBaseHours = functions.reduce((sum, fn) => sum + fn.estimated_hours, 0)
  const totalWeightedHours = functions.reduce((sum, fn) => {
    const multiplier = DIFFICULTY_MULTIPLIERS[fn.difficulty_level] || 1
    return sum + fn.estimated_hours * multiplier
  }, 0)

  // 开始编辑工时
  const startEditing = (fn: FunctionModule) => {
    setEditingId(fn.id)
    setEditingHours(fn.estimated_hours)
  }

  // 保存工时
  const saveHours = async (id: string) => {
    startTransition(async () => {
      const result = await updateFunctionHours(id, editingHours)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('工时已更新')
        setEditingId(null)
        router.refresh()
      }
    })
  }

  // 取消编辑
  const cancelEditing = () => {
    setEditingId(null)
  }

  // 更新难度
  const handleDifficultyChange = async (id: string, difficulty: DifficultyLevel) => {
    startTransition(async () => {
      const result = await updateFunctionDifficulty(id, difficulty)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('难度已更新')
        router.refresh()
      }
    })
  }

  // 删除功能
  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个功能吗？')) return

    startTransition(async () => {
      const result = await deleteFunctionModule(id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('功能已删除')
        router.refresh()
      }
    })
  }

  // 添加功能
  const handleAddFunction = async () => {
    startTransition(async () => {
      const result = await addFunctionModule(projectId, newFunction)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('功能已添加')
        setIsAddDialogOpen(false)
        setNewFunction({
          moduleName: '',
          functionName: '',
          description: '',
          difficultyLevel: 'medium',
          estimatedHours: 8,
        })
        router.refresh()
      }
    })
  }

  if (functions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">暂无功能模块数据</p>
        <p className="text-sm text-muted-foreground">
          请先在需求页面进行 AI 分析，或手动添加功能
        </p>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="mt-4">
              <Plus className="mr-2 h-4 w-4" />
              添加功能
            </Button>
          </DialogTrigger>
          <AddFunctionDialog
            newFunction={newFunction}
            setNewFunction={setNewFunction}
            onSubmit={handleAddFunction}
            isPending={isPending}
          />
        </Dialog>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 操作栏 */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">
          共 {functions.length} 个功能，{Object.keys(groupedFunctions).length} 个模块
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              添加功能
            </Button>
          </DialogTrigger>
          <AddFunctionDialog
            newFunction={newFunction}
            setNewFunction={setNewFunction}
            onSubmit={handleAddFunction}
            isPending={isPending}
          />
        </Dialog>
      </div>

      {/* 功能表格 */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[150px]">模块</TableHead>
              <TableHead>功能名称</TableHead>
              <TableHead className="w-[100px]">难度</TableHead>
              <TableHead className="w-[120px]">基础工时</TableHead>
              <TableHead className="w-[100px]">加权工时</TableHead>
              <TableHead className="w-[80px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(groupedFunctions).map(([moduleName, moduleFunctions]) => (
              moduleFunctions.map((fn, index) => (
                <TableRow key={fn.id}>
                  {index === 0 && (
                    <TableCell
                      rowSpan={moduleFunctions.length}
                      className="font-medium align-top"
                    >
                      {moduleName}
                    </TableCell>
                  )}
                  <TableCell>
                    <div>
                      <p className="font-medium">{fn.function_name}</p>
                      {fn.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {fn.description}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={fn.difficulty_level}
                      onValueChange={(value) =>
                        handleDifficultyChange(fn.id, value as DifficultyLevel)
                      }
                      disabled={isPending}
                    >
                      <SelectTrigger className="h-8 w-[90px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(DIFFICULTY_LABELS).map(([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {editingId === fn.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={editingHours}
                          onChange={(e) => setEditingHours(Number(e.target.value))}
                          className="h-8 w-16"
                          min={0}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => saveHours(fn.id)}
                          disabled={isPending}
                        >
                          {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={cancelEditing}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div
                        className="flex items-center gap-1 cursor-pointer hover:text-primary"
                        onClick={() => startEditing(fn)}
                      >
                        <span>{fn.estimated_hours}h</span>
                        <Pencil className="h-3 w-3 opacity-50" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {Math.round(
                        fn.estimated_hours *
                          (DIFFICULTY_MULTIPLIERS[fn.difficulty_level] || 1)
                      )}h
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-red-500 hover:text-red-600"
                      onClick={() => handleDelete(fn.id)}
                      disabled={isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 汇总信息 */}
      <div className="flex justify-end gap-6 text-sm">
        <div>
          <span className="text-muted-foreground">基础工时合计：</span>
          <span className="font-medium">{totalBaseHours} 小时</span>
        </div>
        <div>
          <span className="text-muted-foreground">加权工时合计：</span>
          <span className="font-medium">{Math.round(totalWeightedHours)} 小时</span>
        </div>
      </div>
    </div>
  )
}

// 添加功能对话框
function AddFunctionDialog({
  newFunction,
  setNewFunction,
  onSubmit,
  isPending,
}: {
  newFunction: {
    moduleName: string
    functionName: string
    description: string
    difficultyLevel: DifficultyLevel
    estimatedHours: number
  }
  setNewFunction: React.Dispatch<React.SetStateAction<typeof newFunction>>
  onSubmit: () => void
  isPending: boolean
}) {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>添加功能</DialogTitle>
        <DialogDescription>手动添加一个功能模块</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>模块名称 *</Label>
          <Input
            value={newFunction.moduleName}
            onChange={(e) =>
              setNewFunction((prev) => ({ ...prev, moduleName: e.target.value }))
            }
            placeholder="如：用户管理"
          />
        </div>
        <div className="space-y-2">
          <Label>功能名称 *</Label>
          <Input
            value={newFunction.functionName}
            onChange={(e) =>
              setNewFunction((prev) => ({ ...prev, functionName: e.target.value }))
            }
            placeholder="如：用户注册"
          />
        </div>
        <div className="space-y-2">
          <Label>功能描述</Label>
          <Textarea
            value={newFunction.description}
            onChange={(e) =>
              setNewFunction((prev) => ({ ...prev, description: e.target.value }))
            }
            placeholder="简要描述功能..."
            rows={2}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>难度等级</Label>
            <Select
              value={newFunction.difficultyLevel}
              onValueChange={(value) =>
                setNewFunction((prev) => ({
                  ...prev,
                  difficultyLevel: value as DifficultyLevel,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DIFFICULTY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>预估工时（小时）</Label>
            <Input
              type="number"
              value={newFunction.estimatedHours}
              onChange={(e) =>
                setNewFunction((prev) => ({
                  ...prev,
                  estimatedHours: Number(e.target.value),
                }))
              }
              min={1}
            />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={onSubmit} disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          添加
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

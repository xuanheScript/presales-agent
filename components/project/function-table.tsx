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
import { Pencil, Trash2, Plus, Loader2, Save, X, ShieldCheck, ShieldOff, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  updateFunctionHours,
  updateRoleEstimateDays,
  deleteFunctionModule,
  addFunctionModule,
  toggleFunctionVerified,
} from '@/app/actions/functions'
import { batchExtractToReferences } from '@/app/actions/estimate-references'
import { DEFAULT_CONFIG } from '@/constants'
import type { FunctionModule } from '@/types'

/**
 * 工时转人天（保留1位小数）
 */
function hoursToWorkDays(hours: number): number {
  return Math.round((hours / DEFAULT_CONFIG.WORKING_HOURS_PER_DAY) * 10) / 10
}

interface ProjectMetadata {
  projectType?: string
  industry?: string
  techStack?: string[]
}

interface FunctionTableProps {
  projectId: string
  functions: FunctionModule[]
  projectMetadata?: ProjectMetadata
}

export function FunctionTable({ projectId, functions, projectMetadata }: FunctionTableProps) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingHours, setEditingHours] = useState<number>(0)
  const [editingRoleKey, setEditingRoleKey] = useState<string | null>(null) // "fnId-roleIndex"
  const [editingRoleDays, setEditingRoleDays] = useState<number>(0)
  const [isPending, startTransition] = useTransition()
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

  // 新增功能表单状态
  const [newFunction, setNewFunction] = useState({
    moduleName: '',
    functionName: '',
    description: '',
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

  // 计算总工时
  const totalHours = functions.reduce((sum, fn) => sum + fn.estimated_hours, 0)

  // 开始编辑工时（以人天为单位）
  const startEditing = (fn: FunctionModule) => {
    setEditingId(fn.id)
    setEditingHours(hoursToWorkDays(fn.estimated_hours))
  }

  // 保存工时（人天转回小时后提交）
  const saveHours = async (id: string) => {
    startTransition(async () => {
      const hours = editingHours * DEFAULT_CONFIG.WORKING_HOURS_PER_DAY
      const result = await updateFunctionHours(id, hours)
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

  // 开始编辑角色工时
  const startEditingRole = (fnId: string, roleIndex: number, currentDays: number) => {
    setEditingRoleKey(`${fnId}-${roleIndex}`)
    setEditingRoleDays(currentDays)
  }

  // 保存角色工时
  const saveRoleDays = async (fnId: string, roleIndex: number) => {
    startTransition(async () => {
      const result = await updateRoleEstimateDays(fnId, roleIndex, editingRoleDays)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('角色工时已更新')
        setEditingRoleKey(null)
        router.refresh()
      }
    })
  }

  // 取消编辑角色工时
  const cancelEditingRole = () => {
    setEditingRoleKey(null)
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

  // 切换验证状态
  const handleToggleVerified = (id: string, currentlyVerified: boolean) => {
    startTransition(async () => {
      const result = await toggleFunctionVerified(id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(currentlyVerified ? '已取消验证标记' : '已标记为已验证估算')
        router.refresh()
      }
    })
  }

  // 批量提取已验证到参考库
  const handleExtractVerified = () => {
    startTransition(async () => {
      const result = await batchExtractToReferences(projectId, {
        projectType: projectMetadata?.projectType,
        industry: projectMetadata?.industry,
        techStack: projectMetadata?.techStack,
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(`已提取 ${result.count} 条估算到参考库`)
        router.refresh()
      }
    })
  }

  const verifiedCount = functions.filter((fn) => fn.is_verified).length

  // 添加功能
  const handleAddFunction = async () => {
    startTransition(async () => {
      const result = await addFunctionModule(projectId, {
        ...newFunction,
        difficultyLevel: 'medium', // 默认值，保持兼容
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('功能已添加')
        setIsAddDialogOpen(false)
        setNewFunction({
          moduleName: '',
          functionName: '',
          description: '',
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
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            共 {functions.length} 个功能，{Object.keys(groupedFunctions).length} 个模块
          </span>
          {verifiedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleExtractVerified}
              disabled={isPending}
            >
              <Upload className="mr-2 h-4 w-4" />
              提取已验证到参考库 ({verifiedCount})
            </Button>
          )}
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
              <TableHead className="w-[120px]">模块</TableHead>
              <TableHead>功能名称</TableHead>
              <TableHead className="min-w-[200px]">角色工时</TableHead>
              <TableHead className="w-[120px]">人天</TableHead>
              <TableHead className="w-[80px]">验证</TableHead>
              <TableHead className="w-[60px]">操作</TableHead>
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
                        <p className="text-xs text-muted-foreground line-clamp-3">
                          {fn.description}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {fn.role_estimates && fn.role_estimates.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {fn.role_estimates.map((re, idx) => {
                          const roleKey = `${fn.id}-${idx}`
                          if (editingRoleKey === roleKey) {
                            return (
                              <div key={idx} className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">{re.role}:</span>
                                <Input
                                  type="number"
                                  value={editingRoleDays}
                                  onChange={(e) => setEditingRoleDays(Number(e.target.value))}
                                  className="h-6 w-14 text-xs"
                                  min={0}
                                  step={0.5}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveRoleDays(fn.id, idx)
                                    if (e.key === 'Escape') cancelEditingRole()
                                  }}
                                />
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  onClick={() => saveRoleDays(fn.id, idx)}
                                  disabled={isPending}
                                >
                                  {isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Save className="h-3 w-3" />
                                  )}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  onClick={cancelEditingRole}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            )
                          }
                          return (
                            <Badge
                              key={idx}
                              variant="outline"
                              className="text-xs cursor-pointer hover:bg-accent"
                              onClick={() => startEditingRole(fn.id, idx, re.days)}
                            >
                              {re.role}: {re.days}人天
                              <Pencil className="ml-1 h-2.5 w-2.5 opacity-40" />
                            </Badge>
                          )
                        })}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
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
                        <span>{hoursToWorkDays(fn.estimated_hours)}人天</span>
                        <Pencil className="h-3 w-3 opacity-50" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant={fn.is_verified ? 'default' : 'ghost'}
                      className={`h-8 w-8 ${fn.is_verified ? 'bg-green-600 hover:bg-green-700' : ''}`}
                      onClick={() => handleToggleVerified(fn.id, fn.is_verified)}
                      disabled={isPending}
                      title={fn.is_verified ? '取消验证' : '标记为已验证'}
                    >
                      {fn.is_verified ? (
                        <ShieldCheck className="h-4 w-4" />
                      ) : (
                        <ShieldOff className="h-4 w-4 opacity-50" />
                      )}
                    </Button>
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
      <div className="flex justify-end text-sm">
        <div>
          <span className="text-muted-foreground">人天合计：</span>
          <span className="font-medium">{hoursToWorkDays(totalHours)} 人天</span>
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
      <DialogFooter>
        <Button onClick={onSubmit} disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          添加
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

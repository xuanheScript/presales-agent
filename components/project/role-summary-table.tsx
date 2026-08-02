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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Pencil, Save, Users, Clock, Calendar, X } from 'lucide-react'
import { toast } from 'sonner'
import { updateProjectRoleHeadcount } from '@/app/actions/roles'
import type { ProjectRole } from '@/app/actions/roles'

interface RoleSummaryTableProps {
  roles: ProjectRole[]
}

export function RoleSummaryTable({ roles }: RoleSummaryTableProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [editingHeadcount, setEditingHeadcount] = useState(1)

  const saveHeadcount = (roleId: string) => {
    startTransition(async () => {
      const result = await updateProjectRoleHeadcount(roleId, editingHeadcount)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('角色人数和成本已更新')
      setEditingRoleId(null)
      router.refresh()
    })
  }

  if (roles.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">暂无角色数据</p>
        <p className="text-sm text-muted-foreground mt-1">
          请先进行 AI 分析以生成角色评估
        </p>
      </div>
    )
  }

  // 计算汇总
  const totalDays = roles.reduce((sum, r) => sum + Number(r.total_days), 0)
  const totalHeadcount = roles.reduce((sum, r) => sum + r.headcount, 0)

  return (
    <div className="space-y-4">
      {/* 角色表格 */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">角色</TableHead>
              <TableHead>职责描述</TableHead>
              <TableHead className="w-[100px] text-center">
                <div className="flex items-center justify-center gap-1">
                  <Clock className="h-4 w-4" />
                  工时(人天)
                </div>
              </TableHead>
              <TableHead className="w-[80px] text-center">
                <div className="flex items-center justify-center gap-1">
                  <Users className="h-4 w-4" />
                  人数
                </div>
              </TableHead>
              <TableHead className="w-[100px] text-center">
                <div className="flex items-center justify-center gap-1">
                  <Calendar className="h-4 w-4" />
                  预估工期
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => {
              const days = Number(role.total_days)
              const estimatedDuration = role.headcount > 0
                ? Math.ceil(days / role.headcount)
                : days

              return (
                <TableRow key={role.id}>
                  <TableCell>
                    <Badge variant="outline" className="font-medium">
                      {role.role_name}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {role.responsibility || '-'}
                  </TableCell>
                  <TableCell className="text-center font-medium">
                    {days}
                  </TableCell>
                  <TableCell className="text-center">
                    {editingRoleId === role.id ? (
                      <div className="flex items-center justify-center gap-1">
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={editingHeadcount}
                          onChange={(event) => setEditingHeadcount(Number(event.target.value))}
                          className="h-8 w-16"
                          disabled={isPending}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => saveHeadcount(role.id)}
                          disabled={isPending}
                        >
                          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setEditingRoleId(null)}
                          disabled={isPending}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-primary"
                        onClick={() => {
                          setEditingRoleId(role.id)
                          setEditingHeadcount(role.headcount)
                        }}
                      >
                        {role.headcount}
                        <Pencil className="h-3 w-3 opacity-50" />
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">
                      {estimatedDuration} 天
                    </Badge>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* 汇总信息 */}
      <div className="flex justify-end gap-6 text-sm">
        <div>
          <span className="text-muted-foreground">总工时：</span>
          <span className="font-medium">{totalDays} 人天</span>
        </div>
        <div>
          <span className="text-muted-foreground">总人数：</span>
          <span className="font-medium">{totalHeadcount} 人</span>
        </div>
      </div>
    </div>
  )
}

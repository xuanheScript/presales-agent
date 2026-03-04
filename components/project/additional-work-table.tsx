'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Clock } from 'lucide-react'
import type { AdditionalWorkItem } from '@/app/actions/roles'

interface AdditionalWorkTableProps {
  items: AdditionalWorkItem[]
}

export function AdditionalWorkTable({ items }: AdditionalWorkTableProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">暂无额外工作项</p>
        <p className="text-sm text-muted-foreground mt-1">
          请先进行 AI 分析以生成额外工作评估
        </p>
      </div>
    )
  }

  // 计算总工时
  const totalDays = items.reduce((sum, i) => sum + Number(i.days), 0)

  return (
    <div className="space-y-4">
      {/* 工作项表格 */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>工作项</TableHead>
              <TableHead className="w-[200px]">负责角色</TableHead>
              <TableHead className="w-[100px] text-center">
                <div className="flex items-center justify-center gap-1">
                  <Clock className="h-4 w-4" />
                  工时(人天)
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">
                  {item.work_item}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {item.assigned_roles.map((role, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {role}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center font-medium">
                  {Number(item.days)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 汇总信息 */}
      <div className="flex justify-end text-sm">
        <div>
          <span className="text-muted-foreground">额外工作总工时：</span>
          <span className="font-medium">{totalDays} 人天</span>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useTransition } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Trash2, Loader2, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { deleteEstimateReference } from '@/app/actions/estimate-references'
import type { EstimateReference } from '@/types'

interface EstimateReferenceListProps {
  references: EstimateReference[]
}

export function EstimateReferenceList({ references }: EstimateReferenceListProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleDelete = (id: string) => {
    if (!confirm('确定要删除这条估算参考吗？')) return

    startTransition(async () => {
      const result = await deleteEstimateReference(id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('已删除')
        router.refresh()
      }
    })
  }

  if (references.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-2">暂无估算参考数据</p>
        <p className="text-sm text-muted-foreground">
          在项目的功能明细页面中，标记评估准确的功能模块为"已验证"，然后提取到参考库
        </p>
      </div>
    )
  }

  // 按 project_type 分组
  const grouped = references.reduce((acc, ref) => {
    const key = ref.project_type || '未分类'
    if (!acc[key]) acc[key] = []
    acc[key].push(ref)
    return acc
  }, {} as Record<string, EstimateReference[]>)

  return (
    <div className="space-y-6">
      {/* 统计信息 */}
      <div className="text-sm text-muted-foreground">
        共 {references.length} 条参考，覆盖 {Object.keys(grouped).length} 种项目类型
      </div>

      {/* 按项目类型分组展示 */}
      {Object.entries(grouped).map(([projectType, refs]) => (
        <div key={projectType} className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Badge variant="secondary">{projectType}</Badge>
            <span className="text-muted-foreground">({refs.length})</span>
          </h4>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">模块</TableHead>
                  <TableHead>功能名称</TableHead>
                  <TableHead className="min-w-[200px]">角色工时</TableHead>
                  <TableHead className="w-[80px]">人天</TableHead>
                  <TableHead className="w-[80px]">引用次数</TableHead>
                  <TableHead className="w-[60px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {refs.map((ref) => (
                  <TableRow key={ref.id}>
                    <TableCell className="font-medium">{ref.module_name}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{ref.function_name}</p>
                        {ref.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {ref.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {ref.role_estimates.map((re, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {re.role}: {re.days}人天
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {ref.role_estimates.reduce((sum, re) => sum + re.days, 0)}人天
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <TrendingUp className="h-3 w-3 text-muted-foreground" />
                        {ref.usage_count}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-red-500 hover:text-red-600"
                        onClick={() => handleDelete(ref.id)}
                        disabled={isPending}
                      >
                        {isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  )
}

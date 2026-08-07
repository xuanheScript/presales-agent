import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Minus, Plus } from 'lucide-react'
import { getEstimateVersionSnapshot } from '@/app/actions/estimate-versions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface CompareEstimateVersionsPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ base?: string; target?: string }>
}

function functionKey(item: { module_name: string; function_name: string }) {
  return `${item.module_name}::${item.function_name}`
}

function roleKey(item: { role_name: string }) {
  return item.role_name
}

function workKey(item: { work_item: string }) {
  return item.work_item
}

export default async function CompareEstimateVersionsPage({
  params,
  searchParams,
}: CompareEstimateVersionsPageProps) {
  const [{ id: projectId }, query] = await Promise.all([params, searchParams])
  if (!query.base || !query.target) notFound()

  const [base, target] = await Promise.all([
    getEstimateVersionSnapshot(projectId, { versionId: query.base }),
    getEstimateVersionSnapshot(projectId, { versionId: query.target }),
  ])
  if (!base || !target) notFound()

  const baseFunctions = new Map(base.functions.map((fn) => [functionKey(fn), fn]))
  const targetFunctions = new Map(target.functions.map((fn) => [functionKey(fn), fn]))
  const keys = Array.from(new Set([...baseFunctions.keys(), ...targetFunctions.keys()])).sort()
  const baseRoles = new Map(base.roles.map((role) => [roleKey(role), role]))
  const targetRoles = new Map(target.roles.map((role) => [roleKey(role), role]))
  const roleKeys = Array.from(new Set([...baseRoles.keys(), ...targetRoles.keys()])).sort()
  const baseWork = new Map(base.additionalWork.map((work) => [workKey(work), work]))
  const targetWork = new Map(target.additionalWork.map((work) => [workKey(work), work]))
  const workKeys = Array.from(new Set([...baseWork.keys(), ...targetWork.keys()])).sort()
  const baseCost = Number(base.cost?.total_cost || 0)
  const targetCost = Number(target.cost?.total_cost || 0)
  const costDelta = targetCost - baseCost

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/projects/${projectId}/estimation/versions`}>
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">返回版本历史</span>
          </Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            v{base.version.revision_no} → v{target.version.revision_no}
          </h2>
          <p className="text-muted-foreground">对比功能、角色、额外工作和成本变化</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-base">功能数量</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{base.functions.length} → {target.functions.length}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">角色 / 额外工作</CardTitle></CardHeader>
          <CardContent className="text-lg font-bold">
            {base.roles.length} → {target.roles.length} / {base.additionalWork.length} → {target.additionalWork.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">总成本变化</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {costDelta >= 0 ? '+' : ''}{costDelta.toLocaleString('zh-CN')}
            </div>
            <div className="text-xs text-muted-foreground">
              ¥{baseCost.toLocaleString('zh-CN')} → ¥{targetCost.toLocaleString('zh-CN')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">需求基线</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {base.version.requirement_baseline_id === target.version.requirement_baseline_id
              ? '未变化'
              : '已变化'}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>功能差异</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>状态</TableHead>
                <TableHead>模块 / 功能</TableHead>
                <TableHead className="text-right">原工时</TableHead>
                <TableHead className="text-right">新工时</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => {
                const before = baseFunctions.get(key)
                const after = targetFunctions.get(key)
                const changed = before && after
                  ? Number(before.estimated_hours) !== Number(after.estimated_hours)
                    || before.difficulty_level !== after.difficulty_level
                    || before.description !== after.description
                  : true
                if (!changed) return null
                return (
                  <TableRow key={key}>
                    <TableCell>
                      {!before ? (
                        <Badge className="bg-green-600"><Plus className="h-3 w-3" />新增</Badge>
                      ) : !after ? (
                        <Badge variant="destructive"><Minus className="h-3 w-3" />删除</Badge>
                      ) : (
                        <Badge variant="secondary">修改</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{after?.module_name || before?.module_name}</div>
                      <div className="text-sm text-muted-foreground">{after?.function_name || before?.function_name}</div>
                    </TableCell>
                    <TableCell className="text-right">{before ? `${before.estimated_hours}h` : '-'}</TableCell>
                    <TableCell className="text-right">{after ? `${after.estimated_hours}h` : '-'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>角色差异</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>角色</TableHead>
                  <TableHead className="text-right">人数</TableHead>
                  <TableHead className="text-right">人天</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roleKeys.map((key) => {
                  const before = baseRoles.get(key)
                  const after = targetRoles.get(key)
                  if (
                    before
                    && after
                    && Number(before.headcount) === Number(after.headcount)
                    && Number(before.total_days) === Number(after.total_days)
                    && before.responsibility === after.responsibility
                  ) return null
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{after?.role_name || before?.role_name}</TableCell>
                      <TableCell className="text-right">
                        {before?.headcount ?? '-'} → {after?.headcount ?? '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {before?.total_days ?? '-'} → {after?.total_days ?? '-'}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {roleKeys.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">无角色数据</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>额外工作差异</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>工作项</TableHead>
                  <TableHead className="text-right">人天变化</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workKeys.map((key) => {
                  const before = baseWork.get(key)
                  const after = targetWork.get(key)
                  if (
                    before
                    && after
                    && Number(before.days) === Number(after.days)
                    && JSON.stringify(before.assigned_roles) === JSON.stringify(after.assigned_roles)
                  ) return null
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{after?.work_item || before?.work_item}</TableCell>
                      <TableCell className="text-right">
                        {before?.days ?? '-'} → {after?.days ?? '-'}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {workKeys.length === 0 && (
                  <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">无额外工作数据</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

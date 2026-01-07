import { Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { FunctionTable } from '@/components/project/function-table'
import { getFunctionModules, getFunctionSummary } from '@/app/actions/functions'
import { DIFFICULTY_MULTIPLIERS } from '@/constants'

interface FunctionsPageProps {
  params: Promise<{ id: string }>
}

export default async function FunctionsPage({ params }: FunctionsPageProps) {
  const { id: projectId } = await params

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">功能明细</h2>
        <p className="text-muted-foreground">
          查看和编辑项目的功能模块列表
        </p>
      </div>

      <Suspense fallback={<FunctionsSkeleton />}>
        <FunctionsContent projectId={projectId} />
      </Suspense>
    </div>
  )
}

async function FunctionsContent({ projectId }: { projectId: string }) {
  const [functions, summary] = await Promise.all([
    getFunctionModules(projectId),
    getFunctionSummary(projectId),
  ])

  // 计算加权工时
  const totalWeightedHours = functions.reduce((sum, fn) => {
    const multiplier = DIFFICULTY_MULTIPLIERS[fn.difficulty_level] || 1
    return sum + fn.estimated_hours * multiplier
  }, 0)

  return (
    <div className="space-y-6">
      {/* 汇总卡片 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>功能总数</CardDescription>
            <CardTitle className="text-3xl">{summary.totalModules}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>基础工时</CardDescription>
            <CardTitle className="text-3xl">{summary.totalHours}h</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>加权工时</CardDescription>
            <CardTitle className="text-3xl">{Math.round(totalWeightedHours)}h</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>难度分布</CardDescription>
            <CardContent className="p-0 pt-1">
              <div className="flex gap-2 text-xs">
                <span className="text-green-600">简单: {summary.byDifficulty.simple}</span>
                <span className="text-yellow-600">中等: {summary.byDifficulty.medium}</span>
                <span className="text-orange-600">复杂: {summary.byDifficulty.complex}</span>
                <span className="text-red-600">非常复杂: {summary.byDifficulty.very_complex}</span>
              </div>
            </CardContent>
          </CardHeader>
        </Card>
      </div>

      {/* 功能表格 */}
      <Card>
        <CardHeader>
          <CardTitle>功能模块列表</CardTitle>
          <CardDescription>
            点击工时可以编辑，选择难度可以调整
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FunctionTable projectId={projectId} functions={functions} />
        </CardContent>
      </Card>
    </div>
  )
}

function FunctionsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-16 mt-2" />
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

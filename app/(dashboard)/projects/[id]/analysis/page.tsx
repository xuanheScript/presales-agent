import Link from 'next/link'
import { Suspense } from 'react'
import { AlertTriangle, History, Sparkles } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getProject } from '@/app/actions/projects'
import { getEstimateVersionSnapshot } from '@/app/actions/estimate-versions'
import { AgentProgress } from '@/components/agent/agent-progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getCurrentRequirementBaseline } from '@/lib/meetings/service'

interface AnalysisPageProps {
  params: Promise<{ id: string }>
}

export default async function AnalysisPage({ params }: AnalysisPageProps) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) notFound()

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Solution & costing
        </p>
        <h2 className="text-2xl font-bold tracking-tight">方案与成本分析</h2>
        <p className="mt-1 text-muted-foreground">
          基于当前正式需求生成可审核的功能方案、工时与成本版本。
        </p>
      </div>

      <Suspense fallback={<AnalysisSkeleton />}>
        <AnalysisContent projectId={id} />
      </Suspense>
    </div>
  )
}

async function AnalysisContent({ projectId }: { projectId: string }) {
  const [baseline, snapshot] = await Promise.all([
    getCurrentRequirementBaseline(projectId),
    getEstimateVersionSnapshot(projectId, { pointer: 'latest' }),
  ])
  const estimateIsCurrent = Boolean(
    baseline && snapshot?.version.requirement_baseline_id === baseline.id,
  )

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {baseline && snapshot && !estimateIsCurrent ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">最新估算基于旧需求</p>
              <p className="mt-1 text-amber-800">
                旧版本仍保留用于审计。请基于需求基线 V{baseline.revision_no} 重新分析后再发布报告。
              </p>
            </div>
          </div>
        ) : null}

        {baseline ? (
          <AgentProgress
            projectId={projectId}
            requirementBaselineId={baseline.id}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                尚未确认正式需求
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 py-8 text-center text-muted-foreground">
              <p className="text-sm">
                请先在需求工作台确认需求来源，形成不可变需求基线后再开始方案分析。
              </p>
              <Button variant="outline" asChild>
                <Link href={`/projects/${projectId}`}>返回需求工作台</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>最新估算版本</CardTitle>
              <CardDescription className="mt-1">
                {snapshot
                  ? `不可变估算版本 V${snapshot.version.revision_no}`
                  : '完成方案分析后将在此生成版本'}
              </CardDescription>
            </div>
            {snapshot ? (
              <Badge variant={estimateIsCurrent ? 'default' : 'outline'}>
                {estimateIsCurrent ? '与需求一致' : '基于旧需求'}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {snapshot ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">版本</span>
                <span className="font-medium">V{snapshot.version.revision_no}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">功能数量</span>
                <span className="font-medium">{snapshot.functions.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">预估总成本</span>
                <span className="font-medium">
                  {snapshot.cost
                    ? `¥${Number(snapshot.cost.total_cost).toLocaleString('zh-CN')}`
                    : '未生成'}
                </span>
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <Button variant="outline" asChild>
                  <Link href={`/projects/${projectId}/estimation/versions/${snapshot.version.id}`}>
                    查看版本详情
                  </Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link href={`/projects/${projectId}/estimation/versions`}>
                    <History className="h-4 w-4" />版本历史
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              确认正式需求并完成分析后，可在此审核和发布估算版本。
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AnalysisSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardContent className="py-6"><Skeleton className="h-85 w-full" /></CardContent></Card>
      <Card><CardContent className="space-y-4 py-6"><Skeleton className="h-7 w-32" /><Skeleton className="h-24 w-full" /><Skeleton className="h-10 w-full" /></CardContent></Card>
    </div>
  )
}

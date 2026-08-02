import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { getProject } from '@/app/actions/projects'
import { getEstimateVersionSnapshot } from '@/app/actions/estimate-versions'
import { PublishEstimateVersionButton } from '@/components/project/publish-estimate-version-button'
import { CostSummary } from '@/components/project/cost-summary'
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

interface EstimateVersionDetailPageProps {
  params: Promise<{ id: string; versionId: string }>
}

export default async function EstimateVersionDetailPage({
  params,
}: EstimateVersionDetailPageProps) {
  const { id: projectId, versionId } = await params
  const [project, snapshot] = await Promise.all([
    getProject(projectId),
    getEstimateVersionSnapshot(projectId, { versionId }),
  ])

  if (!project || !snapshot) notFound()

  const isLatest = project.latest_estimate_version_id === versionId
  const isPublished = project.published_estimate_version_id === versionId

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/projects/${projectId}/estimation/versions`}>
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">返回版本历史</span>
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">
                估算版本 v{snapshot.version.revision_no}
              </h2>
              {isLatest && <Badge>最新</Badge>}
              {isPublished && (
                <Badge variant="outline">
                  <CheckCircle2 className="h-3 w-3" />
                  已发布
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              {snapshot.version.generation_kind === 'ai_workflow' ? 'AI 工作流' : '人工修订'}
              {' · '}
              {new Date(snapshot.version.created_at).toLocaleString('zh-CN')}
            </p>
          </div>
        </div>
        {isLatest && !isPublished && (
          <PublishEstimateVersionButton
            projectId={projectId}
            versionId={versionId}
            revisionNo={snapshot.version.revision_no}
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>版本来源</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          <div><span className="text-muted-foreground">需求基线：</span>{snapshot.version.requirement_baseline_id}</div>
          <div><span className="text-muted-foreground">父版本：</span>{snapshot.version.parent_version_id || '无'}</div>
          <div><span className="text-muted-foreground">模型：</span>{snapshot.version.model_id}</div>
          <div><span className="text-muted-foreground">工作流：</span>{snapshot.version.workflow_version}</div>
          <div><span className="text-muted-foreground">成本规则：</span>{snapshot.version.cost_rule_version}</div>
          <div><span className="text-muted-foreground">快照哈希：</span><span className="break-all font-mono">{snapshot.version.snapshot_hash}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>功能明细（{snapshot.functions.length}）</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模块</TableHead>
                <TableHead>功能</TableHead>
                <TableHead>难度</TableHead>
                <TableHead className="text-right">工时</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.functions.map((fn) => (
                <TableRow key={fn.id}>
                  <TableCell>{fn.module_name}</TableCell>
                  <TableCell>{fn.function_name}</TableCell>
                  <TableCell>{fn.difficulty_level}</TableCell>
                  <TableCell className="text-right">{fn.estimated_hours}h</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {snapshot.cost && <CostSummary cost={snapshot.cost} />}
    </div>
  )
}

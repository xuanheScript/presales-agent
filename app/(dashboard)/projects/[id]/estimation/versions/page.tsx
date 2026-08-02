import Link from 'next/link'
import { CheckCircle2, GitCompareArrows, History } from 'lucide-react'
import { getProject } from '@/app/actions/projects'
import { listEstimateVersions } from '@/app/actions/estimate-versions'
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

interface EstimateVersionsPageProps {
  params: Promise<{ id: string }>
}

export default async function EstimateVersionsPage({ params }: EstimateVersionsPageProps) {
  const { id: projectId } = await params
  const [project, versions] = await Promise.all([
    getProject(projectId),
    listEstimateVersions(projectId),
  ])

  if (!project) return null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <History className="h-5 w-5" />
            估算版本历史
          </h2>
          <p className="text-muted-foreground">
            查看不可变估算快照、来源与发布状态
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/projects/${projectId}/estimation`}>返回当前估算</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>版本列表（{versions.length}）</CardTitle>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              尚未生成估算版本
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>版本</TableHead>
                  <TableHead>生成方式</TableHead>
                  <TableHead>模型 / 工作流</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((version) => {
                  const isLatest = version.id === project.latest_estimate_version_id
                  const isPublished = version.id === project.published_estimate_version_id
                  return (
                    <TableRow key={version.id}>
                      <TableCell>
                        <div className="flex items-center gap-2 font-medium">
                          v{version.revision_no}
                          {isLatest && <Badge>最新</Badge>}
                          {isPublished && (
                            <Badge variant="outline">
                              <CheckCircle2 className="h-3 w-3" />
                              已发布
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {version.generation_kind === 'ai_workflow' ? 'AI 工作流' : '人工修订'}
                      </TableCell>
                      <TableCell>
                        <div>{version.model_id}</div>
                        <div className="text-xs text-muted-foreground">{version.workflow_version}</div>
                      </TableCell>
                      <TableCell>{new Date(version.created_at).toLocaleString('zh-CN')}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {version.parent_version_id && (
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/projects/${projectId}/estimation/versions/compare?base=${version.parent_version_id}&target=${version.id}`}>
                                <GitCompareArrows className="h-4 w-4" />
                                对比
                              </Link>
                            </Button>
                          )}
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/projects/${projectId}/estimation/versions/${version.id}`}>
                              查看
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

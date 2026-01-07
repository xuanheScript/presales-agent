import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { FileText, DollarSign, Clock, AlertTriangle } from 'lucide-react'
import { getProject } from '@/app/actions/projects'
import { getLatestRequirement } from '@/app/actions/requirements'
import { getFunctionModules } from '@/app/actions/functions'
import { getCostEstimate } from '@/app/actions/costs'
import { ExportButtons } from '@/components/project/export-buttons'

// 难度级别显示名称
const DIFFICULTY_LABELS: Record<string, string> = {
  simple: '简单',
  medium: '中等',
  complex: '复杂',
  very_complex: '非常复杂',
}

interface ReportPageProps {
  params: Promise<{ id: string }>
}

export default async function ReportPage({ params }: ReportPageProps) {
  const { id } = await params

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">报告预览</h2>
          <p className="text-muted-foreground">
            查看完整的成本估算报告并导出
          </p>
        </div>
        <Suspense fallback={<Skeleton className="h-10 w-32" />}>
          <ExportButtonsWrapper projectId={id} />
        </Suspense>
      </div>

      <Suspense fallback={<ReportSkeleton />}>
        <ReportContent projectId={id} />
      </Suspense>
    </div>
  )
}

async function ExportButtonsWrapper({ projectId }: { projectId: string }) {
  const [project, requirement, functions, costEstimate] = await Promise.all([
    getProject(projectId),
    getLatestRequirement(projectId),
    getFunctionModules(projectId),
    getCostEstimate(projectId),
  ])

  if (!project) return null

  return (
    <ExportButtons
      project={project}
      requirement={requirement}
      functions={functions}
      costEstimate={costEstimate}
    />
  )
}

async function ReportContent({ projectId }: { projectId: string }) {
  const [project, requirement, functions, costEstimate] = await Promise.all([
    getProject(projectId),
    getLatestRequirement(projectId),
    getFunctionModules(projectId),
    getCostEstimate(projectId),
  ])

  if (!project) {
    notFound()
  }

  const totalHours = functions.reduce((sum, fn) => sum + fn.estimated_hours, 0)

  return (
    <div className="space-y-6">
      {/* 项目概览 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            项目概览
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">项目名称</p>
              <p className="font-medium">{project.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">行业</p>
              <p className="font-medium">{project.industry || '未指定'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">状态</p>
              <Badge variant={project.status === 'completed' ? 'default' : 'secondary'}>
                {project.status === 'completed' ? '已完成' : project.status}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">创建时间</p>
              <p className="font-medium">
                {new Date(project.created_at).toLocaleDateString('zh-CN')}
              </p>
            </div>
          </div>
          {project.description && (
            <div>
              <p className="text-sm text-muted-foreground">项目描述</p>
              <p className="mt-1">{project.description}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 需求分析 */}
      {requirement?.parsed_content && (
        <Card>
          <CardHeader>
            <CardTitle>需求分析</CardTitle>
            <CardDescription>AI 分析结果</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">项目类型</p>
                <p className="font-medium">{requirement.parsed_content.projectType}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">技术栈</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {requirement.parsed_content.techStack.map((tech, index) => (
                    <Badge key={index} variant="outline">
                      {tech}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">业务目标</p>
              <ul className="list-disc list-inside space-y-1">
                {requirement.parsed_content.businessGoals.map((goal, index) => (
                  <li key={index} className="text-sm">
                    {goal}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">核心功能</p>
              <ul className="list-disc list-inside space-y-1">
                {requirement.parsed_content.keyFeatures.map((feature, index) => (
                  <li key={index} className="text-sm">
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            {requirement.parsed_content.risks.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  风险提示
                </p>
                <ul className="list-disc list-inside space-y-1">
                  {requirement.parsed_content.risks.map((risk, index) => (
                    <li key={index} className="text-sm text-yellow-700">
                      {risk}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 功能模块 */}
      {functions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              功能模块
            </CardTitle>
            <CardDescription>
              共 {functions.length} 个功能，预估总工时 {totalHours} 小时
            </CardDescription>
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
                {functions.map((fn) => (
                  <TableRow key={fn.id}>
                    <TableCell className="font-medium">{fn.module_name}</TableCell>
                    <TableCell>{fn.function_name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          fn.difficulty_level === 'simple'
                            ? 'secondary'
                            : fn.difficulty_level === 'complex' || fn.difficulty_level === 'very_complex'
                              ? 'destructive'
                              : 'default'
                        }
                      >
                        {DIFFICULTY_LABELS[fn.difficulty_level] || fn.difficulty_level}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{fn.estimated_hours}h</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Separator className="my-4" />

            <div className="flex justify-end">
              <div className="text-right">
                <p className="text-sm text-muted-foreground">总工时</p>
                <p className="text-2xl font-bold">{totalHours} 小时</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 成本估算 */}
      {costEstimate && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              成本估算
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* 成本汇总 */}
            <div className="grid gap-4 md:grid-cols-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">人力成本</p>
                <p className="text-xl font-bold">
                  ¥{costEstimate.labor_cost.toLocaleString()}
                </p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">服务成本</p>
                <p className="text-xl font-bold">
                  ¥{costEstimate.service_cost.toLocaleString()}
                </p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">基础设施成本</p>
                <p className="text-xl font-bold">
                  ¥{costEstimate.infrastructure_cost.toLocaleString()}
                </p>
              </div>
              <div className="text-center p-4 bg-primary/10 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  总成本（含 {costEstimate.buffer_percentage}% 缓冲）
                </p>
                <p className="text-2xl font-bold text-primary">
                  ¥{costEstimate.total_cost.toLocaleString()}
                </p>
              </div>
            </div>

            {/* 成本明细 */}
            {costEstimate.breakdown && (
              <>
                <Separator />
                <div>
                  <p className="font-medium mb-4">成本明细</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>项目</TableHead>
                        <TableHead className="text-right">金额</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>开发费用</TableCell>
                        <TableCell className="text-right">
                          ¥{costEstimate.breakdown.development.toLocaleString()}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>测试费用</TableCell>
                        <TableCell className="text-right">
                          ¥{costEstimate.breakdown.testing.toLocaleString()}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>部署费用</TableCell>
                        <TableCell className="text-right">
                          ¥{costEstimate.breakdown.deployment.toLocaleString()}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>维护费用</TableCell>
                        <TableCell className="text-right">
                          ¥{costEstimate.breakdown.maintenance.toLocaleString()}
                        </TableCell>
                      </TableRow>
                      {costEstimate.breakdown.thirdPartyServices?.map((service, index) => (
                        <TableRow key={index}>
                          <TableCell>{service.name}</TableCell>
                          <TableCell className="text-right">
                            ¥{service.cost.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* 无数据提示 */}
      {!costEstimate && functions.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p className="font-medium">暂无分析数据</p>
              <p className="text-sm mt-1">
                请先在需求输入页面进行 AI 分析
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i}>
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-5 w-32" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

import { Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FunctionTable } from '@/components/project/function-table'
import { RoleSummaryTable } from '@/components/project/role-summary-table'
import { AdditionalWorkTable } from '@/components/project/additional-work-table'
import { getFunctionModules, getFunctionSummary } from '@/app/actions/functions'
import { getProjectRoles, getAdditionalWorkItems, getAdditionalWorkSummary } from '@/app/actions/roles'
import { getLatestRequirement } from '@/app/actions/requirements'
import { getProject } from '@/app/actions/projects'
import { DEFAULT_CONFIG } from '@/constants'

/**
 * 工时转人天（保留1位小数）
 */
function hoursToWorkDays(hours: number): number {
  return Math.round((hours / DEFAULT_CONFIG.WORKING_HOURS_PER_DAY) * 10) / 10
}

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
  const [functions, summary, roles, additionalWork, additionalWorkSummary, requirement, project] = await Promise.all([
    getFunctionModules(projectId),
    getFunctionSummary(projectId),
    getProjectRoles(projectId),
    getAdditionalWorkItems(projectId),
    getAdditionalWorkSummary(projectId),
    getLatestRequirement(projectId),
    getProject(projectId),
  ])

  // 构建项目元数据，用于批量提取到参考库时自动填充上下文
  const projectMetadata = {
    projectType: requirement?.parsed_content?.projectType,
    industry: project?.industry || undefined,
    techStack: requirement?.parsed_content?.techStack,
  }

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
            <CardDescription>评估工时</CardDescription>
            <CardTitle className="text-3xl">{hoursToWorkDays(summary.totalHours)}人天</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>额外工作</CardDescription>
            <CardTitle className="text-3xl">{additionalWorkSummary.totalDays}人天</CardTitle>
            <p className="text-sm text-muted-foreground">{additionalWorkSummary.totalItems} 项</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>总和工时</CardDescription>
            <CardTitle className="text-3xl text-primary">{hoursToWorkDays(summary.totalHours) + additionalWorkSummary.totalDays}人天</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* 使用 Tabs 组织内容 */}
      <Tabs defaultValue="functions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="functions">功能模块 ({functions.length})</TabsTrigger>
          <TabsTrigger value="roles">角色汇总 ({roles.length})</TabsTrigger>
          <TabsTrigger value="additional">额外工作 ({additionalWork.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="functions">
          <Card>
            <CardHeader>
              <CardTitle>功能模块列表</CardTitle>
              <CardDescription>
                点击工时可以编辑，选择难度可以调整
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FunctionTable projectId={projectId} functions={functions} projectMetadata={projectMetadata} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles">
          <Card>
            <CardHeader>
              <CardTitle>角色工时汇总</CardTitle>
              <CardDescription>
                各角色的工时分配和预估工期
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RoleSummaryTable roles={roles} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="additional">
          <Card>
            <CardHeader>
              <CardTitle>额外工作项</CardTitle>
              <CardDescription>
                非功能开发工作，如架构设计、联调测试、部署上线等
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AdditionalWorkTable items={additionalWork} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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

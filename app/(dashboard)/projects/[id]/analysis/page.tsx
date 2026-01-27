import { Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sparkles, MessageCircle } from 'lucide-react'
import { getProject } from '@/app/actions/projects'
import { getLatestRequirement } from '@/app/actions/requirements'
import { notFound } from 'next/navigation'
import { AgentProgress } from '@/components/agent/agent-progress'
import { AgentChat } from '@/components/agent/agent-chat'

interface AnalysisPageProps {
  params: Promise<{ id: string }>
}

export default async function AnalysisPage({ params }: AnalysisPageProps) {
  const { id } = await params
  const project = await getProject(id)

  if (!project) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">AI 分析</h2>
        <p className="text-muted-foreground">
          AI 将根据需求自动分析并生成功能拆解和成本估算
        </p>
      </div>

      <Suspense fallback={<AnalysisSkeleton />}>
        <AnalysisContent projectId={id} />
      </Suspense>
    </div>
  )
}

async function AnalysisContent({ projectId }: { projectId: string }) {
  const requirement = await getLatestRequirement(projectId)

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* AI 分析区域 */}
      <div className="lg:col-span-2 space-y-6">
        <Tabs defaultValue="analysis" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="analysis" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              AI 分析
            </TabsTrigger>
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              需求澄清
            </TabsTrigger>
          </TabsList>
          <TabsContent value="analysis" className="mt-4">
            {requirement ? (
              <AgentProgress
                projectId={projectId}
                requirementId={requirement.id}
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5" />
                    AI 分析
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8 text-muted-foreground">
                    <Sparkles className="mx-auto h-10 w-10 mb-4 opacity-50" />
                    <p className="font-medium">请先输入需求</p>
                    <p className="text-sm mt-1">
                      在「需求输入」页面保存需求后即可开始 AI 分析
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
          <TabsContent value="chat" className="mt-4">
            <AgentChat projectId={projectId} className="h-[500px]" />
          </TabsContent>
        </Tabs>
      </div>

      {/* 分析结果预览 */}
      <div className="space-y-6">
        {requirement?.parsed_content ? (
          <Card>
            <CardHeader>
              <CardTitle>分析结果预览</CardTitle>
              <CardDescription>
                上次分析结果
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">项目类型</h4>
                <p className="text-sm text-muted-foreground">
                  {requirement.parsed_content.projectType}
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">核心功能</h4>
                <ul className="text-sm text-muted-foreground list-disc list-inside">
                  {requirement.parsed_content.keyFeatures.slice(0, 5).map((feature, index) => (
                    <li key={index}>{feature}</li>
                  ))}
                  {requirement.parsed_content.keyFeatures.length > 5 && (
                    <li>... 还有 {requirement.parsed_content.keyFeatures.length - 5} 项</li>
                  )}
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">技术栈</h4>
                <div className="flex flex-wrap gap-1">
                  {requirement.parsed_content.techStack.map((tech, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-xs"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
              {requirement.parsed_content.risks.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">风险提示</h4>
                  <ul className="text-sm text-muted-foreground list-disc list-inside">
                    {requirement.parsed_content.risks.slice(0, 3).map((risk, index) => (
                      <li key={index}>{risk}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>分析结果预览</CardTitle>
              <CardDescription>
                暂无分析结果
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">完成 AI 分析后将显示结果预览</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function AnalysisSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

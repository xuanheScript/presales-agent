import { Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sparkles, FileText, Upload, MessageCircle } from 'lucide-react'
import { getProject } from '@/app/actions/projects'
import { getLatestRequirement } from '@/app/actions/requirements'
import { notFound } from 'next/navigation'
import { RequirementInput } from '@/components/project/requirement-input'
import { FileUpload } from '@/components/project/file-upload'
import { AgentProgress } from '@/components/agent/agent-progress'
import { AgentChat } from '@/components/agent/agent-chat'

interface ProjectPageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params
  const project = await getProject(id)

  if (!project) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">需求输入</h2>
        <p className="text-muted-foreground">
          输入项目需求后，AI 将自动分析并生成成本估算
        </p>
      </div>

      <Suspense fallback={<RequirementSkeleton />}>
        <RequirementContent projectId={id} />
      </Suspense>
    </div>
  )
}

async function RequirementContent({ projectId }: { projectId: string }) {
  const requirement = await getLatestRequirement(projectId)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* 需求输入区域 */}
      <div className="space-y-6">
        <Tabs defaultValue="text" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              文本输入
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              文档上传
            </TabsTrigger>
          </TabsList>
          <TabsContent value="text" className="mt-4">
            <RequirementInput
              projectId={projectId}
              requirement={requirement}
            />
          </TabsContent>
          <TabsContent value="upload" className="mt-4">
            <FileUpload projectId={projectId} />
          </TabsContent>
        </Tabs>
      </div>

      {/* AI 分析区域 */}
      <div className="space-y-6">
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
                      保存需求后即可开始 AI 分析
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

        {/* 分析结果预览 */}
        {requirement?.parsed_content && (
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
        )}
      </div>
    </div>
  )
}

function RequirementSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-[200px] w-full" />
          <div className="flex justify-end">
            <Skeleton className="h-10 w-24" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

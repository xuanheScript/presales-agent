import { Suspense } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowRight } from 'lucide-react'
import { getProject } from '@/app/actions/projects'
import { getLatestRequirement } from '@/app/actions/requirements'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { RequirementInput } from '@/components/project/requirement-input'
import { FileUpload } from '@/components/project/file-upload'

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">需求输入</h2>
          <p className="text-muted-foreground">
            输入或上传项目需求文档，保存后即可进行 AI 分析
          </p>
        </div>
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
    <div className="space-y-6">
      {/* 需求状态提示 */}
      {requirement ? (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <div>
                <p className="font-medium text-green-800">需求已保存</p>
                <p className="text-sm text-green-600">
                  上次保存: {new Date(requirement.created_at).toLocaleString('zh-CN')}
                </p>
              </div>
            </div>
            <Link
              href={`/projects/${projectId}/analysis`}
              className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
            >
              开始 AI 分析
              <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-amber-500" />
              <div>
                <p className="font-medium text-amber-800">尚未保存需求</p>
                <p className="text-sm text-amber-600">
                  请通过下方任一方式输入需求内容
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 输入方式 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 文本输入 */}
        <RequirementInput
          projectId={projectId}
          requirement={requirement}
        />

        {/* 文档上传 */}
        <FileUpload projectId={projectId} />
      </div>

      {/* 使用提示 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">使用提示</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>支持直接粘贴需求文本或上传文档</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>文档支持 Word (.docx) 和 PDF 格式</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>需求内容越详细，AI 分析结果越准确</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>保存后可随时修改，支持多次分析</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function RequirementSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-4">
          <Skeleton className="h-6 w-48" />
        </CardContent>
      </Card>
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
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[200px] w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

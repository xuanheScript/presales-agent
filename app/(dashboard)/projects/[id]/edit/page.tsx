import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ProjectForm } from '@/components/project/project-form'
import { getProject } from '@/app/actions/projects'
import { ArrowLeft } from 'lucide-react'

interface EditProjectPageProps {
  params: Promise<{ id: string }>
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params
  const project = await getProject(id)

  if (!project) {
    notFound()
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/projects/${id}`}>
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">返回</span>
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">编辑项目</h1>
          <p className="text-muted-foreground">
            修改项目 "{project.name}" 的基本信息
          </p>
        </div>
      </div>

      {/* 项目表单 */}
      <div className="max-w-2xl">
        <ProjectForm project={project} mode="edit" />
      </div>
    </div>
  )
}

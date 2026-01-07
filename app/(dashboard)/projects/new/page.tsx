import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ProjectForm } from '@/components/project/project-form'
import { ArrowLeft } from 'lucide-react'

export default function NewProjectPage() {
  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/projects">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">返回</span>
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">新建项目</h1>
          <p className="text-muted-foreground">
            创建一个新的成本估算项目
          </p>
        </div>
      </div>

      {/* 项目表单 */}
      <div className="max-w-2xl">
        <ProjectForm mode="create" />
      </div>
    </div>
  )
}

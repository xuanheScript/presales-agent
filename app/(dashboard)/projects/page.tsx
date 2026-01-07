import { Suspense } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus } from 'lucide-react'
import { getProjects } from '@/app/actions/projects'
import { ProjectList } from '@/components/project/project-list'
import type { ProjectStatus } from '@/types'

interface ProjectsPageProps {
  searchParams: Promise<{
    search?: string
    status?: ProjectStatus
    industry?: string
    page?: string
  }>
}

function ProjectListSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4">
        <Skeleton className="h-10 flex-1" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-[140px]" />
          <Skeleton className="h-10 w-[140px]" />
          <Skeleton className="h-10 w-[80px]" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-[180px] rounded-xl" />
        ))}
      </div>
    </div>
  )
}

async function ProjectListWrapper({ searchParams }: ProjectsPageProps) {
  const params = await searchParams
  const page = parseInt(params.page || '1', 10)
  const pageSize = 12

  const { projects, total } = await getProjects({
    search: params.search,
    status: params.status,
    industry: params.industry,
    page,
    pageSize,
  })

  return (
    <ProjectList
      projects={projects}
      total={total}
      page={page}
      pageSize={pageSize}
    />
  )
}

export default async function ProjectsPage(props: ProjectsPageProps) {
  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">项目管理</h1>
          <p className="text-muted-foreground">
            管理您的所有估算项目
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/new">
            <Plus className="mr-2 h-4 w-4" />
            新建项目
          </Link>
        </Button>
      </div>

      {/* 项目列表 */}
      <Suspense fallback={<ProjectListSkeleton />}>
        <ProjectListWrapper searchParams={props.searchParams} />
      </Suspense>
    </div>
  )
}

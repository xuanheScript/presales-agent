'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  FolderKanban,
  MoreHorizontal,
  Eye,
  Pencil,
  Archive,
  Trash2,
} from 'lucide-react'
import type { Project } from '@/types'
import { deleteProject, archiveProject } from '@/app/actions/projects'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

interface ProjectCardProps {
  project: Project
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  analyzing: { label: '分析中', variant: 'default' },
  completed: { label: '已完成', variant: 'outline' },
  archived: { label: '已归档', variant: 'destructive' },
}

export function ProjectCard({ project }: ProjectCardProps) {
  const router = useRouter()

  const handleDelete = async () => {
    if (!confirm('确定要删除这个项目吗？此操作不可恢复。')) {
      return
    }

    const result = await deleteProject(project.id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('项目已删除')
      router.refresh()
    }
  }

  const handleArchive = async () => {
    const result = await archiveProject(project.id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('项目已归档')
      router.refresh()
    }
  }

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
              <FolderKanban className="h-5 w-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg truncate">
                <Link href={`/projects/${project.id}`} className="hover:text-blue-600 transition-colors">
                  {project.name}
                </Link>
              </CardTitle>
              <CardDescription className="truncate">
                {project.industry || '未指定行业'}
              </CardDescription>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">操作菜单</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/projects/${project.id}`}>
                  <Eye className="mr-2 h-4 w-4" />
                  查看详情
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/projects/${project.id}/edit`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  编辑项目
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {project.status !== 'archived' && (
                <DropdownMenuItem onClick={handleArchive}>
                  <Archive className="mr-2 h-4 w-4" />
                  归档项目
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleDelete} className="text-red-600">
                <Trash2 className="mr-2 h-4 w-4" />
                删除项目
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <Badge variant={statusMap[project.status]?.variant || 'secondary'}>
            {statusMap[project.status]?.label || project.status}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {new Date(project.created_at).toLocaleDateString('zh-CN')}
          </span>
        </div>
        {project.description && (
          <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
            {project.description}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

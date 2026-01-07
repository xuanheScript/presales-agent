import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getProject } from '@/app/actions/projects'
import {
  ArrowLeft,
  MoreHorizontal,
  Pencil,
  Archive,
  Trash2,
  FileText,
  Layers,
  Calculator,
  FileOutput,
} from 'lucide-react'

interface ProjectLayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  analyzing: { label: '分析中', variant: 'default' },
  completed: { label: '已完成', variant: 'outline' },
  archived: { label: '已归档', variant: 'destructive' },
}

const tabs = [
  { value: '', label: '需求输入', icon: FileText },
  { value: '/functions', label: '功能明细', icon: Layers },
  { value: '/estimation', label: '成本估算', icon: Calculator },
  { value: '/report', label: '报告预览', icon: FileOutput },
]

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const { id } = await params
  const project = await getProject(id)

  if (!project) {
    notFound()
  }

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/projects">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">返回</span>
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            <Badge variant={statusMap[project.status]?.variant || 'secondary'}>
              {statusMap[project.status]?.label || project.status}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            {project.industry || '未指定行业'} · 创建于 {new Date(project.created_at).toLocaleDateString('zh-CN')}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">更多操作</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/projects/${id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                编辑项目
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {project.status !== 'archived' && (
              <DropdownMenuItem>
                <Archive className="mr-2 h-4 w-4" />
                归档项目
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-red-600">
              <Trash2 className="mr-2 h-4 w-4" />
              删除项目
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 标签页导航 */}
      <Tabs defaultValue="" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} asChild>
              <Link href={`/projects/${id}${tab.value}`} className="flex items-center gap-2">
                <tab.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 页面内容 */}
      {children}
    </div>
  )
}

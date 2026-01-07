import { Suspense } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Plus, FileText } from 'lucide-react'
import { getTemplates } from '@/app/actions/templates'
import { TemplateActions } from '@/components/template/template-actions'

// 模板类型显示名称
const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  requirement_analysis: '需求分析',
  function_breakdown: '功能拆解',
  effort_estimation: '工时评估',
  cost_calculation: '成本计算',
}

export default function TemplatesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">模板管理</h2>
          <p className="text-muted-foreground">
            管理 AI Agent 使用的提示词模板
          </p>
        </div>
        <Button asChild>
          <Link href="/templates/new">
            <Plus className="mr-2 h-4 w-4" />
            新建模板
          </Link>
        </Button>
      </div>

      <Suspense fallback={<TemplatesSkeleton />}>
        <TemplatesList />
      </Suspense>
    </div>
  )
}

async function TemplatesList() {
  const templates = await getTemplates()

  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p className="font-medium">暂无模板</p>
            <p className="text-sm mt-1">创建你的第一个提示词模板</p>
            <Button asChild className="mt-4">
              <Link href="/templates/new">
                <Plus className="mr-2 h-4 w-4" />
                新建模板
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // 按类型分组
  const groupedTemplates = templates.reduce((acc, template) => {
    const type = template.template_type
    if (!acc[type]) {
      acc[type] = []
    }
    acc[type].push(template)
    return acc
  }, {} as Record<string, typeof templates>)

  return (
    <div className="space-y-6">
      {Object.entries(groupedTemplates).map(([type, typeTemplates]) => (
        <Card key={type}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {TEMPLATE_TYPE_LABELS[type] || type}
            </CardTitle>
            <CardDescription>
              共 {typeTemplates.length} 个模板
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>模板名称</TableHead>
                  <TableHead>行业</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="w-[70px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {typeTemplates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell>
                      <Link
                        href={`/templates/${template.id}`}
                        className="font-medium hover:underline"
                      >
                        {template.template_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {template.industry || '通用'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">v{template.version}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={template.is_active ? 'default' : 'secondary'}>
                        {template.is_active ? '启用' : '停用'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(template.updated_at).toLocaleDateString('zh-CN')}
                    </TableCell>
                    <TableCell>
                      <TemplateActions
                        templateId={template.id}
                        isActive={template.is_active}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function TemplatesSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-4 w-[100px]" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import {
  FolderKanban,
  Clock,
  DollarSign,
  TrendingUp,
  Plus,
  ArrowRight,
} from 'lucide-react'

interface DashboardStats {
  totalProjects: number
  monthlyProjects: number
  totalEstimatedCost: number
  averageHours: number
}

interface RecentProject {
  id: string
  name: string
  status: string
  created_at: string
  industry: string | null
}

async function getDashboardData() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { stats: null, recentProjects: [] }
  }

  // 获取项目总数
  const { count: totalProjects } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', user.id)

  // 获取本月新增项目
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { count: monthlyProjects } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .gte('created_at', startOfMonth.toISOString())

  // 获取总成本估算
  const { data: costData } = await supabase
    .from('cost_estimates')
    .select('total_cost, project_id')

  // 获取总工时
  const { data: hoursData } = await supabase
    .from('function_modules')
    .select('estimated_hours')

  const totalEstimatedCost = costData?.reduce((sum, item) => sum + Number(item.total_cost), 0) || 0
  const totalHours = hoursData?.reduce((sum, item) => sum + Number(item.estimated_hours), 0) || 0
  const averageHours = hoursData?.length ? totalHours / hoursData.length : 0

  // 获取最近项目
  const { data: recentProjects } = await supabase
    .from('projects')
    .select('id, name, status, created_at, industry')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })
    .limit(5)

  return {
    stats: {
      totalProjects: totalProjects || 0,
      monthlyProjects: monthlyProjects || 0,
      totalEstimatedCost,
      averageHours: Math.round(averageHours),
    },
    recentProjects: recentProjects || [],
  }
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  analyzing: { label: '分析中', variant: 'default' },
  completed: { label: '已完成', variant: 'outline' },
  archived: { label: '已归档', variant: 'destructive' },
}

export default async function DashboardPage() {
  const { stats, recentProjects } = await getDashboardData()

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">仪表盘</h1>
          <p className="text-muted-foreground">
            欢迎使用售前成本估算系统
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/new">
            <Plus className="mr-2 h-4 w-4" />
            新建项目
          </Link>
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">项目总数</CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalProjects || 0}</div>
            <p className="text-xs text-muted-foreground">
              所有估算项目
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">本月新增</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.monthlyProjects || 0}</div>
            <p className="text-xs text-muted-foreground">
              本月创建的项目
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">总报价金额</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ¥{(stats?.totalEstimatedCost || 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              累计成本估算
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">平均工时</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.averageHours || 0}h</div>
            <p className="text-xs text-muted-foreground">
              每个功能模块
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 最近项目 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>最近项目</CardTitle>
              <CardDescription>您最近创建的估算项目</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/projects">
                查看全部
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {recentProjects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FolderKanban className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p>暂无项目</p>
              <p className="text-sm">点击"新建项目"开始您的第一个估算</p>
            </div>
          ) : (
            <div className="space-y-4">
              {recentProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <FolderKanban className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium">{project.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {project.industry || '未指定行业'} · {new Date(project.created_at).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                  </div>
                  <Badge variant={statusMap[project.status]?.variant || 'secondary'}>
                    {statusMap[project.status]?.label || project.status}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

import { Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Plus, Library, Search, Clock, DollarSign } from 'lucide-react'
import { getFunctionLibraryItems, getFunctionCategories } from '@/app/actions/function-library'
import { FUNCTION_CATEGORIES } from '@/constants'
import { FunctionLibraryDialog } from '@/components/function-library/function-library-dialog'
import { FunctionLibraryActions } from '@/components/function-library/function-library-actions'

interface FunctionLibraryPageProps {
  searchParams: Promise<{
    category?: string
    search?: string
  }>
}

export default async function FunctionLibraryPage({ searchParams }: FunctionLibraryPageProps) {
  const params = await searchParams

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">功能库</h2>
          <p className="text-muted-foreground">
            管理标准功能模块及其工时参考
          </p>
        </div>
        <FunctionLibraryDialog>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            新建功能
          </Button>
        </FunctionLibraryDialog>
      </div>

      {/* 搜索和筛选 */}
      <Card>
        <CardContent className="pt-6">
          <form className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                name="search"
                placeholder="搜索功能名称..."
                defaultValue={params.search}
                className="pl-10"
              />
            </div>
            <select
              name="category"
              defaultValue={params.category || ''}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
            >
              <option value="">全部分类</option>
              {FUNCTION_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <Button type="submit">筛选</Button>
          </form>
        </CardContent>
      </Card>

      <Suspense fallback={<FunctionLibrarySkeleton />}>
        <FunctionLibraryList category={params.category} search={params.search} />
      </Suspense>
    </div>
  )
}

async function FunctionLibraryList({
  category,
  search,
}: {
  category?: string
  search?: string
}) {
  const items = await getFunctionLibraryItems({ category, search })

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <Library className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p className="font-medium">暂无功能</p>
            <p className="text-sm mt-1">
              {search || category ? '没有找到匹配的功能' : '创建你的第一个标准功能'}
            </p>
            {!search && !category && (
              <FunctionLibraryDialog>
                <Button className="mt-4">
                  <Plus className="mr-2 h-4 w-4" />
                  新建功能
                </Button>
              </FunctionLibraryDialog>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // 按分类分组
  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = []
    }
    acc[item.category].push(item)
    return acc
  }, {} as Record<string, typeof items>)

  // 统计信息
  const totalItems = items.length
  const totalHours = items.reduce((sum, item) => sum + item.standard_hours, 0)
  const avgHours = totalHours / totalItems

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>功能总数</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalItems}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>总标准工时</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-1">
              <Clock className="h-5 w-5 text-muted-foreground" />
              {totalHours.toFixed(0)} 小时
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>平均工时</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgHours.toFixed(1)} 小时</div>
          </CardContent>
        </Card>
      </div>

      {/* 功能列表 */}
      {Object.entries(groupedItems).map(([categoryName, categoryItems]) => (
        <Card key={categoryName}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Library className="h-5 w-5" />
              {categoryName}
            </CardTitle>
            <CardDescription>共 {categoryItems.length} 个功能</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>功能名称</TableHead>
                  <TableHead>描述</TableHead>
                  <TableHead className="text-right">标准工时</TableHead>
                  <TableHead className="text-right">参考成本</TableHead>
                  <TableHead className="w-[70px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.function_name}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[300px] truncate">
                      {item.description || '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="font-mono">
                        {item.standard_hours}h
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.reference_cost ? (
                        <span className="flex items-center justify-end gap-1 text-muted-foreground">
                          <DollarSign className="h-3 w-3" />
                          {item.reference_cost.toLocaleString()}
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <FunctionLibraryActions item={item} />
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

function FunctionLibrarySkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
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

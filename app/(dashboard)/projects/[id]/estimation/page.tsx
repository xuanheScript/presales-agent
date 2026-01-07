import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CostSummary, CostSummaryEmpty } from '@/components/project/cost-summary'
import { getCostEstimate } from '@/app/actions/costs'

interface EstimationPageProps {
  params: Promise<{ id: string }>
}

export default async function EstimationPage({ params }: EstimationPageProps) {
  const { id: projectId } = await params

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">成本估算</h2>
        <p className="text-muted-foreground">
          查看项目的成本估算详情
        </p>
      </div>

      <Suspense fallback={<EstimationSkeleton />}>
        <EstimationContent projectId={projectId} />
      </Suspense>
    </div>
  )
}

async function EstimationContent({ projectId }: { projectId: string }) {
  const cost = await getCostEstimate(projectId)

  if (!cost) {
    return <CostSummaryEmpty />
  }

  return <CostSummary cost={cost} />
}

function EstimationSkeleton() {
  return (
    <div className="space-y-6">
      {/* 总成本卡片骨架 */}
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-48 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-40" />
        </CardContent>
      </Card>

      {/* 成本分解卡片骨架 */}
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-24 mt-2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 详细分解骨架 */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

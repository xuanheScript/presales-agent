'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  DollarSign,
  Users,
  Server,
  Shield,
  TrendingUp,
} from 'lucide-react'
import type { CostEstimate } from '@/types'

interface CostSummaryProps {
  cost: CostEstimate
}

/**
 * 格式化金额
 */
function formatCurrency(amount: number): string {
  return `¥${amount.toLocaleString('zh-CN')}`
}

export function CostSummary({ cost }: CostSummaryProps) {
  // 计算百分比
  const baseCost = cost.labor_cost + cost.service_cost + cost.infrastructure_cost
  const bufferAmount = cost.total_cost - baseCost

  const laborPercent = baseCost > 0 ? Math.round((cost.labor_cost / baseCost) * 100) : 0
  const servicePercent = baseCost > 0 ? Math.round((cost.service_cost / baseCost) * 100) : 0
  const infraPercent = baseCost > 0 ? Math.round((cost.infrastructure_cost / baseCost) * 100) : 0

  return (
    <div className="space-y-6">
      {/* 总成本卡片 */}
      <Card className="bg-primary text-primary-foreground">
        <CardHeader>
          <CardDescription className="text-primary-foreground/80">
            项目总成本（含风险缓冲）
          </CardDescription>
          <CardTitle className="text-4xl font-bold">
            {formatCurrency(cost.total_cost)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-primary-foreground/80">
            <Shield className="h-4 w-4" />
            <span>已包含 {cost.buffer_percentage}% 风险缓冲金额</span>
          </div>
        </CardContent>
      </Card>

      {/* 成本分解 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-500" />
              <CardDescription>人力成本</CardDescription>
            </div>
            <CardTitle className="text-2xl">{formatCurrency(cost.labor_cost)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">占基础成本</span>
              <Badge variant="secondary">{laborPercent}%</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-green-500" />
              <CardDescription>服务成本</CardDescription>
            </div>
            <CardTitle className="text-2xl">{formatCurrency(cost.service_cost)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">占基础成本</span>
              <Badge variant="secondary">{servicePercent}%</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              <CardDescription>基础设施</CardDescription>
            </div>
            <CardTitle className="text-2xl">{formatCurrency(cost.infrastructure_cost)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">占基础成本</span>
              <Badge variant="secondary">{infraPercent}%</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 详细分解 */}
      <Card>
        <CardHeader>
          <CardTitle>成本明细</CardTitle>
          <CardDescription>各阶段成本分解</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 人力成本明细 */}
          <div>
            <h4 className="font-medium mb-3">人力成本分解</h4>
            <div className="space-y-2">
              <CostLine
                label="开发费用"
                amount={cost.breakdown?.development || 0}
              />
              <CostLine
                label="测试费用"
                amount={cost.breakdown?.testing || 0}
              />
              <CostLine
                label="部署集成费用"
                amount={cost.breakdown?.deployment || 0}
              />
              {cost.breakdown?.maintenance > 0 && (
                <CostLine
                  label="维护费用"
                  amount={cost.breakdown?.maintenance || 0}
                />
              )}
            </div>
          </div>

          {/* 第三方服务成本 */}
          {cost.breakdown?.thirdPartyServices &&
            cost.breakdown.thirdPartyServices.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="font-medium mb-3">第三方服务成本</h4>
                  <div className="space-y-2">
                    {cost.breakdown.thirdPartyServices.map((service, index) => (
                      <CostLine
                        key={index}
                        label={service.name}
                        amount={service.cost}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

          <Separator />

          {/* 风险缓冲 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-yellow-500" />
              <span className="font-medium">风险缓冲 ({cost.buffer_percentage}%)</span>
            </div>
            <span className="font-medium text-yellow-600">
              +{formatCurrency(bufferAmount)}
            </span>
          </div>

          <Separator />

          {/* 总计 */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-lg font-bold">总计</span>
            <span className="text-lg font-bold text-primary">
              {formatCurrency(cost.total_cost)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 说明 */}
      <Card>
        <CardHeader>
          <CardTitle>费用说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong>人力成本：</strong>
            基于工时估算和人天单价计算，包括开发、测试和集成联调费用。
          </p>
          <p>
            <strong>服务成本：</strong>
            包括云服务器、CI/CD工具等第三方服务费用。
          </p>
          <p>
            <strong>风险缓冲：</strong>
            为应对需求变更、技术风险等不确定因素预留的缓冲资金。
          </p>
          <p className="text-xs border-t pt-3 mt-3">
            * 以上报价仅供参考，实际费用可能因需求变更、市场因素等有所调整。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function CostLine({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{formatCurrency(amount)}</span>
    </div>
  )
}

/**
 * 成本估算空状态
 */
export function CostSummaryEmpty() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <DollarSign className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium mb-2">暂无成本估算</h3>
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          请先在需求页面输入项目需求并进行 AI 分析，系统将自动生成成本估算。
        </p>
      </CardContent>
    </Card>
  )
}

'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DollarSign,
  Users,
  Server,
  Shield,
  TrendingUp,
  Calendar,
  UserCheck,
} from 'lucide-react'
import type { CostEstimate } from '@/types'

interface CostSummaryProps {
  cost: CostEstimate
}

/**
 * 格式化金额
 */
function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toLocaleString('zh-CN')}`
  }
}

/**
 * 判断是否为新版本数据（有 roleBreakdown）
 */
function isNewVersionData(cost: CostEstimate): boolean {
  return cost.rule_version === 'formal-workflow-v1'
    || !!(cost.breakdown?.roleBreakdown && cost.breakdown.roleBreakdown.length > 0)
}

export function CostSummary({ cost }: CostSummaryProps) {
  const isNewVersion = isNewVersionData(cost)
  const currency = cost.currency || 'CNY'

  // 计算百分比和缓冲金额
  const baseCost = cost.labor_cost + cost.service_cost + cost.infrastructure_cost

  // 旧版本的缓冲是总成本中的独立加项；正式规则 v1 已将缓冲折算进人力成本。
  const legacyBufferAmount = isNewVersion ? 0 : cost.total_cost - baseCost

  const laborPercent = baseCost > 0 ? Math.round((cost.labor_cost / baseCost) * 100) : 0
  const servicePercent = baseCost > 0 ? Math.round((cost.service_cost / baseCost) * 100) : 0
  const infraPercent = baseCost > 0 ? Math.round((cost.infrastructure_cost / baseCost) * 100) : 0

  // 缓冲系数显示
  const bufferDisplay = cost.buffer_coefficient
    ? `${cost.buffer_coefficient}x`
    : `${cost.buffer_percentage}%`

  return (
    <div className="space-y-6">
      {/* 总成本卡片 */}
      <Card className="bg-primary text-primary-foreground">
        <CardHeader>
          <CardDescription className="text-primary-foreground/80">
            项目总成本（含风险缓冲）
          </CardDescription>
          <CardTitle className="text-4xl font-bold">
            {formatCurrency(cost.total_cost, currency)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm text-primary-foreground/80">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <span>缓冲系数: {bufferDisplay}</span>
            </div>
            {isNewVersion && cost.base_days && cost.buffered_days && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>{cost.base_days} → {cost.buffered_days} 人天</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 工时概览（新版本显示） */}
      {isNewVersion && cost.base_days && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>基础人天</CardDescription>
              <CardTitle className="text-2xl">{cost.base_days}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>含缓冲人天</CardDescription>
              <CardTitle className="text-2xl">{cost.buffered_days}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>缓冲系数</CardDescription>
              <CardTitle className="text-2xl">{cost.buffer_coefficient}x</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>团队规模</CardDescription>
              <CardTitle className="text-2xl">
                {cost.breakdown?.roleBreakdown?.reduce((sum, r) => sum + r.headcount, 0) || '-'} 人
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* 成本分解 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-500" />
              <CardDescription>人力成本</CardDescription>
            </div>
            <CardTitle className="text-2xl">{formatCurrency(cost.labor_cost, currency)}</CardTitle>
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
            <CardTitle className="text-2xl">{formatCurrency(cost.service_cost, currency)}</CardTitle>
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
            <CardTitle className="text-2xl">{formatCurrency(cost.infrastructure_cost, currency)}</CardTitle>
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
          <CardDescription>
            {isNewVersion ? '功能开发按角色列示，额外工作单独列示，两部分合计为人力成本' : '各阶段成本分解'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 新版本：按角色分解 */}
          {isNewVersion && cost.breakdown?.roleBreakdown && (
            <div>
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <UserCheck className="h-4 w-4" />
                功能开发角色成本
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>角色</TableHead>
                    <TableHead className="text-right">人天</TableHead>
                    <TableHead className="text-right">人数</TableHead>
                    <TableHead className="text-right">成本</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cost.breakdown.roleBreakdown.map((role, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{role.role}</TableCell>
                      <TableCell className="text-right">{role.days}</TableCell>
                      <TableCell className="text-right">{role.headcount}</TableCell>
                      <TableCell className="text-right">{formatCurrency(role.cost, currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* 新版本：额外工作分解 */}
          {isNewVersion && cost.breakdown?.additionalWorkBreakdown && cost.breakdown.additionalWorkBreakdown.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="font-medium mb-3">额外工作成本</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>工作项</TableHead>
                      <TableHead className="text-right">人天</TableHead>
                      <TableHead className="text-right">成本</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cost.breakdown.additionalWorkBreakdown.map((work, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{work.workItem}</TableCell>
                        <TableCell className="text-right">{work.days}</TableCell>
                        <TableCell className="text-right">{formatCurrency(work.cost, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {/* 旧版本：按阶段分解 */}
          {!isNewVersion && (
            <div>
              <h4 className="font-medium mb-3">人力成本分解</h4>
              <div className="space-y-2">
                <CostLine
                  label="开发费用"
                  amount={cost.breakdown?.development || 0}
                  currency={currency}
                />
                <CostLine
                  label="测试费用"
                  amount={cost.breakdown?.testing || 0}
                  currency={currency}
                />
                <CostLine
                  label="部署集成费用"
                  amount={cost.breakdown?.deployment || 0}
                  currency={currency}
                />
                {(cost.breakdown?.maintenance ?? 0) > 0 && (
                  <CostLine
                    label="维护费用"
                    amount={cost.breakdown?.maintenance || 0}
                    currency={currency}
                  />
                )}
              </div>
            </div>
          )}

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
                        currency={currency}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

          <Separator />

          {/* 风险缓冲说明：正式规则已包含在人力成本中，不作为总计加项 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-yellow-500" />
              <span className="font-medium">
                风险缓冲 ({bufferDisplay})
              </span>
            </div>
            <span className="font-medium text-yellow-600">
              {isNewVersion
                ? `已计入人力成本${cost.breakdown?.bufferDays !== undefined ? `（+${cost.breakdown.bufferDays} 人天）` : ''}`
                : `+${formatCurrency(legacyBufferAmount, currency)}`}
            </span>
          </div>

          <Separator />

          {/* 总计 */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-lg font-bold">总计</span>
            <span className="text-lg font-bold text-primary">
              {formatCurrency(cost.total_cost, currency)}
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
            基于工时估算和人天单价计算，按角色分解展示各角色的工时和成本。
          </p>
          <p>
            <strong>服务成本：</strong>
            包括云服务器、CI/CD工具等第三方服务费用。
          </p>
          <p>
            <strong>缓冲系数：</strong>
            根据项目类型和复杂度自动评估（1.2x - 2.0x），用于应对需求变更、技术风险等不确定因素。
          </p>
          <p className="text-xs border-t pt-3 mt-3">
            * 以上为内部估算成本，不包含利润、折扣和税费，不应直接作为对外报价。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function CostLine({
  label,
  amount,
  currency,
}: {
  label: string
  amount: number
  currency: string
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{formatCurrency(amount, currency)}</span>
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

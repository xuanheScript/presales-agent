'use client'

import { useActionState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Save } from 'lucide-react'
import { updateSystemConfig } from '@/app/actions/settings'
import { DEFAULT_CONFIG } from '@/constants'
import type { SystemConfig } from '@/types'
import { toast } from 'sonner'

interface SystemConfigFormProps {
  config: SystemConfig | null
}

interface FormState {
  success: boolean
  error?: string
}

const CURRENCIES = [
  { value: 'CNY', label: '人民币 (CNY)' },
  { value: 'USD', label: '美元 (USD)' },
  { value: 'EUR', label: '欧元 (EUR)' },
  { value: 'JPY', label: '日元 (JPY)' },
]

export function SystemConfigForm({ config }: SystemConfigFormProps) {
  const handleSubmit = async (
    _prevState: FormState,
    formData: FormData
  ): Promise<FormState> => {
    const result = await updateSystemConfig(formData)
    if (result.success) {
      toast.success('配置已保存')
    }
    return result
  }

  const [state, formAction, isPending] = useActionState(handleSubmit, {
    success: false,
  })

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    }
  }, [state.error])

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {/* 人天成本 */}
        <div className="space-y-2">
          <Label htmlFor="labor_cost_per_day">默认人天成本</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              ¥
            </span>
            <Input
              id="labor_cost_per_day"
              name="labor_cost_per_day"
              type="number"
              min="1"
              step="100"
              defaultValue={config?.default_labor_cost_per_day || DEFAULT_CONFIG.LABOR_COST_PER_DAY}
              className="pl-8"
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">
            每人天的基础成本，用于成本计算
          </p>
        </div>

        {/* 风险缓冲比例 */}
        <div className="space-y-2">
          <Label htmlFor="risk_buffer_percentage">风险缓冲比例</Label>
          <div className="relative">
            <Input
              id="risk_buffer_percentage"
              name="risk_buffer_percentage"
              type="number"
              min="0"
              max="100"
              step="1"
              defaultValue={config?.default_risk_buffer_percentage || DEFAULT_CONFIG.RISK_BUFFER_PERCENTAGE}
              className="pr-8"
              required
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              %
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            在总成本基础上增加的风险缓冲百分比
          </p>
        </div>

        {/* 货币 */}
        <div className="space-y-2">
          <Label htmlFor="currency">货币单位</Label>
          <Select
            name="currency"
            defaultValue={config?.currency || DEFAULT_CONFIG.CURRENCY}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择货币" />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((currency) => (
                <SelectItem key={currency.value} value={currency.value}>
                  {currency.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            报告和界面显示的货币单位
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              保存中...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              保存配置
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

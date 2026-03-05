import { getFunctionLibraryItems } from '@/app/actions/function-library'
import { getAllFunctionGroupsWithItems } from '@/app/actions/function-groups'
import { getSystemConfig } from '@/app/actions/settings'
import { QuickEstimateWorkspace } from '@/components/quick-estimate/quick-estimate-workspace'
import { DEFAULT_CONFIG } from '@/constants'

export default async function QuickEstimatePage() {
  const [items, groups, config] = await Promise.all([
    getFunctionLibraryItems(),
    getAllFunctionGroupsWithItems(),
    getSystemConfig(),
  ])

  const defaultLaborCostPerDay = config?.default_labor_cost_per_day ?? DEFAULT_CONFIG.LABOR_COST_PER_DAY

  return (
    <div className="container max-w-7xl py-6">
      <QuickEstimateWorkspace
        items={items}
        groups={groups}
        defaultLaborCostPerDay={defaultLaborCostPerDay}
      />
    </div>
  )
}

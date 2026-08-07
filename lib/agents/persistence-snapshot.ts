import { PresalesExecutionError } from './execution-errors'
import type {
  PreparedPresalesExecution,
  PresalesPersistenceSnapshot,
} from './execution-service'
import type { WorkflowResult } from './state'

export function buildPresalesPersistenceSnapshot(
  result: WorkflowResult,
  prepared: PreparedPresalesExecution
): PresalesPersistenceSnapshot {
  if (!result.success || !result.analysis || !result.estimation || !result.cost) {
    throw new PresalesExecutionError(result.error || '工作流结果不完整，不能保存', 500)
  }

  const staffingByRoleMap = new Map(
    result.cost.staffingByRole.map((role) => [role.role, role.totalDays])
  )

  return {
    parsedRequirement: result.analysis,
    functionModules: result.functions.map((fn) => ({
      module_name: fn.moduleName,
      function_name: fn.functionName,
      description: fn.description,
      difficulty_level: fn.difficultyLevel,
      estimated_hours: fn.roleEstimates.reduce(
        (sum, role) => sum + role.days * prepared.systemConfig.workingHoursPerDay,
        0
      ),
      dependencies: fn.dependencies || null,
      role_estimates: fn.roleEstimates,
    })),
    projectRoles: result.identifiedRoles.map((role) => ({
      role_name: role.role,
      responsibility: role.responsibility,
      headcount: role.headcount,
      total_days: staffingByRoleMap.get(role.role) || 0,
    })),
    additionalWorkItems: result.additionalWork.map((work) => ({
      work_item: work.workItem,
      days: work.days,
      assigned_roles: work.assignedRoles,
    })),
    costEstimate: {
      labor_cost: result.cost.laborCost,
      service_cost: result.cost.serviceCost,
      infrastructure_cost: result.cost.infrastructureCost,
      buffer_percentage: Number(((result.cost.bufferCoefficient - 1) * 100).toFixed(10)),
      total_cost: result.cost.totalCost,
      base_days: result.cost.baseDays,
      buffered_days: result.cost.bufferedDays,
      buffer_coefficient: result.cost.bufferCoefficient,
      rule_version: result.cost.ruleVersion,
      service_policy_version: result.cost.servicePolicyVersion,
      currency: result.cost.currency,
      labor_cost_per_day: result.cost.laborCostPerDay,
      working_hours_per_day: result.cost.workingHoursPerDay,
      breakdown: {
        roleBreakdown: result.cost.roleBreakdown,
        additionalWorkBreakdown: result.cost.additionalWorkBreakdown,
        thirdPartyServices: result.cost.thirdPartyServices,
        ruleVersion: result.cost.ruleVersion,
        servicePolicyVersion: result.cost.servicePolicyVersion,
        currency: result.cost.currency,
        laborCostPerDay: result.cost.laborCostPerDay,
        workingHoursPerDay: result.cost.workingHoursPerDay,
        bufferDays: result.cost.bufferDays,
        estimatedDurationDays: result.cost.estimatedDurationDays,
        reconciliation: result.cost.reconciliation,
      },
    },
    outputData: result,
  }
}

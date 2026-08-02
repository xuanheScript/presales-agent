export const FORMAL_COST_RULE_VERSION = 'formal-workflow-v1' as const
export const FORMAL_SERVICE_POLICY_VERSION = 'formal-service-v1' as const

export type FormalCostRuleVersion = typeof FORMAL_COST_RULE_VERSION
export type FormalServicePolicyVersion = typeof FORMAL_SERVICE_POLICY_VERSION

export interface CostingRoleInput {
  role: string
  headcount: number
}

export interface CostingRoleEffortInput {
  role: string
  days: number
}

export interface CostingFunctionInput {
  functionId?: string
  roleEfforts: CostingRoleEffortInput[]
}

export interface CostingAdditionalWorkInput {
  workItemId?: string
  workItem: string
  days: number
  assignedRoles: string[]
}

export interface FormalCostCalculationInputV1 {
  ruleVersion: FormalCostRuleVersion
  currency: string
  laborCostPerDay: number
  workingHoursPerDay: number
  bufferCoefficient: number
  roles: CostingRoleInput[]
  functions: CostingFunctionInput[]
  additionalWork: CostingAdditionalWorkInput[]
}

export interface StaffingByRole {
  role: string
  functionalDays: number
  additionalDays: number
  totalDays: number
  headcount: number
}

export interface RoleCostLine {
  role: string
  baseDays: number
  bufferedDays: number
  cost: number
  headcount: number
}

export interface AdditionalWorkCostLine {
  workItem: string
  baseDays: number
  bufferedDays: number
  cost: number
}

export interface ServiceCostLine {
  code: 'development_environment' | 'ci_cd'
  name: string
  quantity: number
  unitCost: number
  cost: number
}

export interface FormalCostCalculationResultV1 {
  ruleVersion: FormalCostRuleVersion
  servicePolicyVersion: FormalServicePolicyVersion
  currency: string
  laborCostPerDay: number
  workingHoursPerDay: number
  bufferCoefficient: number
  functionalDays: number
  additionalWorkDays: number
  baseDays: number
  bufferDays: number
  bufferedDays: number
  estimatedDurationDays: number
  staffingByRole: StaffingByRole[]
  functionalRoleBreakdown: RoleCostLine[]
  additionalWorkBreakdown: AdditionalWorkCostLine[]
  thirdPartyServices: ServiceCostLine[]
  laborCost: number
  serviceCost: number
  infrastructureCost: number
  totalCost: number
  reconciliation: {
    laborLinesTotal: number
    laborCostDifference: number
    isBalanced: boolean
  }
}

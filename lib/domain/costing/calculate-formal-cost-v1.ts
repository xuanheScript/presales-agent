import {
  FORMAL_COST_RULE_VERSION,
  FORMAL_SERVICE_POLICY_VERSION,
  type AdditionalWorkCostLine,
  type FormalCostCalculationInputV1,
  type FormalCostCalculationResultV1,
  type RoleCostLine,
  type ServiceCostLine,
  type StaffingByRole,
} from './types'

const FORMAL_SERVICE_POLICY_V1 = {
  teamSizeThreshold: 3,
  billingCycleDays: 30,
  developmentEnvironmentCostPerCycle: 2000,
  ciCdEffortThresholdDays: 100,
  ciCdCostPerCycle: 500,
} as const

function roundToDecimal(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field}必须是有限的非负数`)
  }
}

function validateInput(input: FormalCostCalculationInputV1): void {
  if (input.ruleVersion !== FORMAL_COST_RULE_VERSION) {
    throw new Error(`不支持的成本规则版本: ${input.ruleVersion}`)
  }
  if (!input.currency.trim()) {
    throw new Error('币种不能为空')
  }
  if (!Number.isFinite(input.laborCostPerDay) || input.laborCostPerDay <= 0) {
    throw new Error('人天单价必须是有限的正数')
  }
  if (!Number.isFinite(input.workingHoursPerDay) || input.workingHoursPerDay <= 0) {
    throw new Error('每日工作小时数必须是有限的正数')
  }
  if (!Number.isFinite(input.bufferCoefficient) || input.bufferCoefficient < 1 || input.bufferCoefficient > 2.5) {
    throw new Error('缓冲系数必须在 1.0 到 2.5 之间')
  }

  const roleNames = new Set<string>()
  for (const role of input.roles) {
    const roleName = role.role.trim()
    if (!roleName) {
      throw new Error('角色名称不能为空')
    }
    if (role.role !== roleName) {
      throw new Error(`角色名称不能包含首尾空白: ${role.role}`)
    }
    if (roleNames.has(roleName)) {
      throw new Error(`角色重复: ${roleName}`)
    }
    if (!Number.isInteger(role.headcount) || role.headcount <= 0) {
      throw new Error(`${roleName}的人数必须是正整数`)
    }
    roleNames.add(roleName)
  }

  for (const fn of input.functions) {
    for (const effort of fn.roleEfforts) {
      if (!roleNames.has(effort.role)) {
        throw new Error(`功能工时引用了不存在的角色: ${effort.role}`)
      }
      assertFiniteNonNegative(effort.days, `${effort.role}的功能人天`)
    }
  }

  for (const work of input.additionalWork) {
    if (!work.workItem.trim()) {
      throw new Error('额外工作项名称不能为空')
    }
    assertFiniteNonNegative(work.days, `${work.workItem}的人天`)
    if (work.assignedRoles.length === 0) {
      throw new Error(`${work.workItem}必须至少分配一个角色`)
    }
    for (const role of new Set(work.assignedRoles)) {
      if (!roleNames.has(role)) {
        throw new Error(`${work.workItem}引用了不存在的角色: ${role}`)
      }
    }
  }
}

function allocateRoundedCosts<T extends { bufferedDays: number }>(
  lines: T[],
  targetCost: number,
  laborCostPerDay: number
): Array<T & { cost: number }> {
  if (lines.length === 0) return []

  const exactCosts = lines.map((line, index) => ({
    index,
    exact: line.bufferedDays * laborCostPerDay,
  }))
  const costs = exactCosts.map((item) => Math.floor(item.exact))
  let remaining = targetCost - costs.reduce((sum, cost) => sum + cost, 0)
  const allocationOrder = [...exactCosts].sort((a, b) => {
    const remainderDifference = (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact))
    return remainderDifference || b.exact - a.exact || a.index - b.index
  })

  for (let index = 0; remaining > 0; index++) {
    costs[allocationOrder[index % allocationOrder.length].index] += 1
    remaining--
  }

  for (let index = allocationOrder.length - 1; remaining < 0 && index >= 0; index--) {
    const targetIndex = allocationOrder[index].index
    const deduction = Math.min(costs[targetIndex], -remaining)
    costs[targetIndex] -= deduction
    remaining += deduction
    if (index === 0 && remaining < 0) index = allocationOrder.length
  }

  if (remaining !== 0) {
    throw new Error('人力成本明细无法与总额对账')
  }

  return lines.map((line, index) => ({ ...line, cost: costs[index] }))
}

export function calculateFormalCostV1(
  input: FormalCostCalculationInputV1
): FormalCostCalculationResultV1 {
  validateInput(input)

  const staffingMap = new Map<string, StaffingByRole>(
    input.roles.map((role) => [role.role, {
      role: role.role,
      functionalDays: 0,
      additionalDays: 0,
      totalDays: 0,
      headcount: role.headcount,
    }])
  )

  for (const fn of input.functions) {
    for (const effort of fn.roleEfforts) {
      const staffing = staffingMap.get(effort.role)!
      staffing.functionalDays += effort.days
    }
  }

  for (const work of input.additionalWork) {
    const assignedRoles = Array.from(new Set(work.assignedRoles))
    const daysPerRole = work.days / assignedRoles.length
    for (const role of assignedRoles) {
      staffingMap.get(role)!.additionalDays += daysPerRole
    }
  }

  const staffingByRole = Array.from(staffingMap.values()).map((role) => ({
    ...role,
    functionalDays: roundToDecimal(role.functionalDays, 1),
    additionalDays: roundToDecimal(role.additionalDays, 1),
    totalDays: roundToDecimal(role.functionalDays + role.additionalDays, 1),
  }))

  const functionalDays = input.functions.reduce(
    (sum, fn) => sum + fn.roleEfforts.reduce((roleSum, effort) => roleSum + effort.days, 0),
    0
  )
  const additionalWorkDays = input.additionalWork.reduce((sum, work) => sum + work.days, 0)
  const baseDaysRaw = functionalDays + additionalWorkDays
  const baseDays = roundToDecimal(baseDaysRaw, 1)
  const bufferedDays = roundToDecimal(baseDaysRaw * input.bufferCoefficient, 1)
  const bufferDays = roundToDecimal(bufferedDays - baseDays, 1)
  const laborCost = Math.round(bufferedDays * input.laborCostPerDay)

  const unpricedRoleLines: Omit<RoleCostLine, 'cost'>[] = staffingByRole
    .filter((role) => role.functionalDays > 0)
    .map((role) => ({
      role: role.role,
      baseDays: role.functionalDays,
      bufferedDays: roundToDecimal(role.functionalDays * input.bufferCoefficient, 1),
      headcount: role.headcount,
    }))

  const unpricedAdditionalLines: Omit<AdditionalWorkCostLine, 'cost'>[] = input.additionalWork.map((work) => ({
    workItem: work.workItem,
    baseDays: roundToDecimal(work.days, 1),
    bufferedDays: roundToDecimal(work.days * input.bufferCoefficient, 1),
  }))

  const combinedLines = allocateRoundedCosts(
    [
      ...unpricedRoleLines.map((line) => ({ type: 'role' as const, ...line })),
      ...unpricedAdditionalLines.map((line) => ({ type: 'additional' as const, ...line })),
    ],
    laborCost,
    input.laborCostPerDay
  )

  const functionalRoleBreakdown: RoleCostLine[] = combinedLines
    .filter((line): line is typeof line & { type: 'role'; role: string; headcount: number } => line.type === 'role')
    .map((line) => ({
      role: line.role,
      baseDays: line.baseDays,
      bufferedDays: line.bufferedDays,
      cost: line.cost,
      headcount: line.headcount,
    }))
  const additionalWorkBreakdown: AdditionalWorkCostLine[] = combinedLines
    .filter((line): line is typeof line & { type: 'additional'; workItem: string } => line.type === 'additional')
    .map((line) => ({
      workItem: line.workItem,
      baseDays: line.baseDays,
      bufferedDays: line.bufferedDays,
      cost: line.cost,
    }))

  const teamSize = input.roles.reduce((sum, role) => sum + role.headcount, 0)
  const maxRoleDays = staffingByRole.length > 0
    ? Math.max(...staffingByRole.map((role) => role.totalDays / role.headcount))
    : 0
  const estimatedDurationDays = Math.ceil(maxRoleDays * input.bufferCoefficient)
  const billingCycles = estimatedDurationDays > 0
    ? Math.ceil(estimatedDurationDays / FORMAL_SERVICE_POLICY_V1.billingCycleDays)
    : 0
  const thirdPartyServices: ServiceCostLine[] = []

  if (teamSize >= FORMAL_SERVICE_POLICY_V1.teamSizeThreshold && billingCycles > 0) {
    thirdPartyServices.push({
      code: 'development_environment',
      name: '云服务器（开发测试环境）',
      quantity: billingCycles,
      unitCost: FORMAL_SERVICE_POLICY_V1.developmentEnvironmentCostPerCycle,
      cost: billingCycles * FORMAL_SERVICE_POLICY_V1.developmentEnvironmentCostPerCycle,
    })
  }

  if (baseDaysRaw > FORMAL_SERVICE_POLICY_V1.ciCdEffortThresholdDays && billingCycles > 0) {
    thirdPartyServices.push({
      code: 'ci_cd',
      name: 'CI/CD 工具服务',
      quantity: billingCycles,
      unitCost: FORMAL_SERVICE_POLICY_V1.ciCdCostPerCycle,
      cost: billingCycles * FORMAL_SERVICE_POLICY_V1.ciCdCostPerCycle,
    })
  }

  const laborLinesTotal = combinedLines.reduce((sum, line) => sum + line.cost, 0)
  const laborCostDifference = laborCost - laborLinesTotal
  const serviceCost = thirdPartyServices.reduce((sum, service) => sum + service.cost, 0)
  const infrastructureCost = 0

  return {
    ruleVersion: FORMAL_COST_RULE_VERSION,
    servicePolicyVersion: FORMAL_SERVICE_POLICY_VERSION,
    currency: input.currency,
    laborCostPerDay: input.laborCostPerDay,
    workingHoursPerDay: input.workingHoursPerDay,
    bufferCoefficient: input.bufferCoefficient,
    functionalDays: roundToDecimal(functionalDays, 1),
    additionalWorkDays: roundToDecimal(additionalWorkDays, 1),
    baseDays,
    bufferDays,
    bufferedDays,
    estimatedDurationDays,
    staffingByRole,
    functionalRoleBreakdown,
    additionalWorkBreakdown,
    thirdPartyServices,
    laborCost,
    serviceCost,
    infrastructureCost,
    totalCost: laborCost + serviceCost + infrastructureCost,
    reconciliation: {
      laborLinesTotal,
      laborCostDifference,
      isBalanced: laborCostDifference === 0,
    },
  }
}

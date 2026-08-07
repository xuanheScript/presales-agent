import { describe, expect, it } from 'vitest'
import {
  FORMAL_COST_RULE_VERSION,
  calculateFormalCostV1,
  type FormalCostCalculationInputV1,
} from '..'

function createInput(
  overrides: Partial<FormalCostCalculationInputV1> = {}
): FormalCostCalculationInputV1 {
  return {
    ruleVersion: FORMAL_COST_RULE_VERSION,
    currency: 'CNY',
    laborCostPerDay: 1500,
    workingHoursPerDay: 8,
    bufferCoefficient: 1.3,
    roles: [
      { role: '后端开发', headcount: 2 },
      { role: '前端开发', headcount: 1 },
    ],
    functions: [
      {
        functionId: 'FUN-1',
        roleEfforts: [
          { role: '后端开发', days: 40 },
          { role: '前端开发', days: 20 },
        ],
      },
    ],
    additionalWork: [
      {
        workItemId: 'EXTRA-1',
        workItem: '架构与联调',
        days: 10,
        assignedRoles: ['后端开发', '前端开发'],
      },
    ],
    ...overrides,
  }
}

describe('calculateFormalCostV1', () => {
  it('保持正式工作流 v1 的总成本公式', () => {
    const result = calculateFormalCostV1(createInput())

    expect(result.functionalDays).toBe(60)
    expect(result.additionalWorkDays).toBe(10)
    expect(result.baseDays).toBe(70)
    expect(result.bufferedDays).toBe(91)
    expect(result.laborCost).toBe(136500)
    expect(result.serviceCost).toBe(4000)
    expect(result.totalCost).toBe(140500)
    expect(result.estimatedDurationDays).toBe(33)
  })

  it('将功能角色成本与额外工作成本拆开且可对账', () => {
    const result = calculateFormalCostV1(createInput())
    const functionalCost = result.functionalRoleBreakdown.reduce((sum, line) => sum + line.cost, 0)
    const additionalCost = result.additionalWorkBreakdown.reduce((sum, line) => sum + line.cost, 0)

    expect(functionalCost + additionalCost).toBe(result.laborCost)
    expect(result.reconciliation).toEqual({
      laborLinesTotal: result.laborCost,
      laborCostDifference: 0,
      isBalanced: true,
    })
  })

  it('只让缓冲影响人力成本，不放大服务成本', () => {
    const lowBuffer = calculateFormalCostV1(createInput({ bufferCoefficient: 1 }))
    const highBuffer = calculateFormalCostV1(createInput({ bufferCoefficient: 2 }))

    expect(highBuffer.laborCost).toBe(lowBuffer.laborCost * 2)
    expect(highBuffer.thirdPartyServices[0].unitCost).toBe(lowBuffer.thirdPartyServices[0].unitCost)
  })

  it('在基础人天超过 100 时加入 CI/CD 服务费', () => {
    const result = calculateFormalCostV1(createInput({
      bufferCoefficient: 1,
      functions: [{
        roleEfforts: [
          { role: '后端开发', days: 80 },
          { role: '前端开发', days: 21 },
        ],
      }],
      additionalWork: [],
    }))

    expect(result.thirdPartyServices.map((service) => service.code)).toEqual([
      'development_environment',
      'ci_cd',
    ])
  })

  it('极端小额工作项的明细成本仍然非负且可对账', () => {
    const result = calculateFormalCostV1(createInput({
      roles: [{ role: '开发', headcount: 1 }],
      functions: Array.from({ length: 100 }, (_, index) => ({
        functionId: `FUN-${index}`,
        roleEfforts: [{ role: '开发', days: 0.04 }],
      })),
      additionalWork: [],
    }))

    expect(result.functionalRoleBreakdown.every((line) => line.cost >= 0)).toBe(true)
    expect(result.reconciliation.isBalanced).toBe(true)
  })

  it('拒绝带首尾空白的角色名，避免引用规范不一致', () => {
    expect(() => calculateFormalCostV1(createInput({
      roles: [{ role: ' 后端开发', headcount: 1 }],
      functions: [],
      additionalWork: [],
    }))).toThrow('不能包含首尾空白')
  })

  it('拒绝额外工作没有承担角色', () => {
    expect(() => calculateFormalCostV1(createInput({
      additionalWork: [{
        workItem: '架构设计',
        days: 5,
        assignedRoles: [],
      }],
    }))).toThrow('必须至少分配一个角色')
  })

  it('拒绝非正整数角色人数', () => {
    expect(() => calculateFormalCostV1(createInput({
      roles: [{ role: '后端开发', headcount: 0 }],
      functions: [],
      additionalWork: [],
    }))).toThrow('人数必须是正整数')
  })
})

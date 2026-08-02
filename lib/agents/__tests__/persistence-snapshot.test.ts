import { describe, expect, it } from 'vitest'
import { buildPresalesPersistenceSnapshot } from '../persistence-snapshot'
import type { PreparedPresalesExecution } from '../execution-service'
import type { WorkflowResult } from '../state'

function createPrepared(workingHoursPerDay = 8): PreparedPresalesExecution {
  return {
    userId: 'user-1',
    projectId: 'project-1',
    requirementBaselineId: 'baseline-1',
    requirementBaselineRevision: 1,
    requirementBaselineContentHash: 'a'.repeat(64),
    canonicalRequirement: '需求',
    projectDescription: '项目',
    analysisPromptTemplate: '需求分析提示词',
    previousProjectStatus: 'draft',
    systemConfig: {
      laborCostPerDay: 1_000,
      riskBufferPercentage: 30,
      workingHoursPerDay,
      currency: 'CNY',
    },
    provenance: {
      modelId: 'deepseek-chat',
      workflowVersion: 'presales-workflow-v1',
      promptVersions: {
        analysis: 'requirement-analysis-v1',
        breakdown: 'batched_structured_v2',
        estimate: 'buffer-estimation-v1',
        calculate: 'formal-workflow-v1',
      },
      outputSchemaVersion: 'presales-estimate-v1',
    },
  }
}

function createResult(): WorkflowResult {
  return {
    success: true,
    analysis: {
      projectType: '管理系统',
      businessGoals: ['提升效率'],
      keyFeatures: ['订单管理'],
      techStack: ['Next.js'],
      nonFunctionalRequirements: { security: '需要权限控制' },
      risks: ['接口延期'],
    },
    functions: [
      {
        moduleName: '订单',
        functionName: '订单管理',
        description: '维护订单',
        difficultyLevel: 'medium',
        roleEstimates: [
          { role: '前端', days: 1.5 },
          { role: '后端', days: 2 },
        ],
      },
      {
        moduleName: '报表',
        functionName: '导出',
        description: '导出报表',
        difficultyLevel: 'simple',
        roleEstimates: [{ role: '后端', days: 0.5 }],
        dependencies: [],
      },
    ],
    identifiedRoles: [
      { role: '前端', responsibility: '页面', headcount: 1 },
      { role: '后端', responsibility: '接口', headcount: 2 },
      { role: '测试', responsibility: '质量', headcount: 1 },
    ],
    additionalWork: [
      { workItem: '部署', days: 1, assignedRoles: ['后端'] },
    ],
    estimation: {
      identifiedRoles: [],
      additionalWork: [],
      roleSummary: [],
      bufferCoefficient: 1.3,
      bufferReason: '存在风险',
    },
    cost: {
      ruleVersion: 'formal-workflow-v1',
      servicePolicyVersion: 'formal-service-v1',
      currency: 'CNY',
      laborCostPerDay: 1_000,
      workingHoursPerDay: 8,
      baseDays: 5,
      bufferDays: 1.5,
      bufferedDays: 6.5,
      bufferCoefficient: 1.3,
      estimatedDurationDays: 4,
      staffingByRole: [
        { role: '前端', functionalDays: 1.5, additionalDays: 0, totalDays: 1.5, headcount: 1 },
        { role: '后端', functionalDays: 2.5, additionalDays: 1, totalDays: 3.5, headcount: 2 },
      ],
      roleBreakdown: [
        { role: '前端', days: 1.95, baseDays: 1.5, cost: 1_950, headcount: 1 },
        { role: '后端', days: 3.25, baseDays: 2.5, cost: 3_250, headcount: 2 },
      ],
      additionalWorkBreakdown: [
        { workItem: '部署', days: 1.3, baseDays: 1, cost: 1_300 },
      ],
      laborCost: 6_500,
      serviceCost: 300,
      infrastructureCost: 0,
      totalCost: 6_800,
      thirdPartyServices: [
        { code: 'development_environment', name: '开发环境', quantity: 1, unitCost: 300, cost: 300 },
      ],
      reconciliation: {
        laborLinesTotal: 6_500,
        laborCostDifference: 0,
        isBalanced: true,
      },
    },
    error: null,
  }
}

describe('buildPresalesPersistenceSnapshot', () => {
  it('完整映射工作流结果且不修改输入', () => {
    const result = createResult()
    const before = structuredClone(result)

    const snapshot = buildPresalesPersistenceSnapshot(result, createPrepared())

    expect(snapshot.functionModules).toEqual([
      expect.objectContaining({ estimated_hours: 28, dependencies: null }),
      expect.objectContaining({ estimated_hours: 4, dependencies: [] }),
    ])
    expect(snapshot.projectRoles).toEqual([
      expect.objectContaining({ role_name: '前端', total_days: 1.5 }),
      expect.objectContaining({ role_name: '后端', total_days: 3.5 }),
      expect.objectContaining({ role_name: '测试', total_days: 0 }),
    ])
    expect(snapshot.additionalWorkItems).toEqual([
      { work_item: '部署', days: 1, assigned_roles: ['后端'] },
    ])
    expect(snapshot.costEstimate).toMatchObject({
      labor_cost: 6_500,
      service_cost: 300,
      buffer_percentage: 30,
      rule_version: 'formal-workflow-v1',
      service_policy_version: 'formal-service-v1',
      breakdown: {
        currency: 'CNY',
        reconciliation: { isBalanced: true },
      },
    })
    expect(snapshot.outputData).toBe(result)
    expect(result).toEqual(before)
  })

  it('使用准备阶段的工作日小时数计算 estimated_hours', () => {
    const result = createResult()

    const snapshot = buildPresalesPersistenceSnapshot(result, createPrepared(7.5))

    expect(snapshot.functionModules[0].estimated_hours).toBe(26.25)
  })

  it.each([
    ['失败结果', { success: false }],
    ['缺少 analysis', { analysis: null }],
    ['缺少 estimation', { estimation: null }],
    ['缺少 cost', { cost: null }],
  ])('%s 时拒绝保存', (_name, patch) => {
    const result = { ...createResult(), ...patch }

    expect(() => buildPresalesPersistenceSnapshot(result, createPrepared()))
      .toThrow('工作流结果不完整，不能保存')
  })
})

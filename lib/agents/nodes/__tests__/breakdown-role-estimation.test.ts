import { describe, expect, it } from 'vitest'
import type { AgentFunctionModule, IdentifiedRole } from '../../state'
import {
  assignFunctionIds,
  assignRoleIds,
  mergeRoleEffortBatches,
  partitionFunctionBatches,
  validateRoleEffortBatch,
  type RoleEffortBatchItem,
} from '../breakdown-role-estimation'

function createFunctions(count: number): AgentFunctionModule[] {
  return Array.from({ length: count }, (_, index) => ({
    moduleName: `模块${Math.floor(index / 5) + 1}`,
    functionName: `功能${index + 1}`,
    description: `功能${index + 1}描述`,
    difficultyLevel: 'medium',
    roleEstimates: [],
    dependencies: [],
  }))
}

function createRoles(): IdentifiedRole[] {
  return [
    { role: '后端开发', responsibility: '服务端开发', headcount: 2 },
    { role: '前端开发', responsibility: '前端开发', headcount: 1 },
  ]
}

function createValidOutput(
  functionIds: string[],
  roleId: string
): RoleEffortBatchItem[] {
  return functionIds.map((functionId, index) => ({
    functionId,
    roleEstimates: [{ roleId, days: index + 1 }],
  }))
}

describe('Breakdown 分批角色工时', () => {
  it('为相同需求和功能生成稳定 ID，且不受描述变化影响', () => {
    const original = assignFunctionIds('REQ-1', createFunctions(2))
    const changedDescription = createFunctions(2)
    changedDescription[0].description = '更新后的功能描述'
    const repeated = assignFunctionIds('REQ-1', changedDescription)

    expect(repeated.map((item) => item.functionId)).toEqual(
      original.map((item) => item.functionId)
    )
    expect(original.every((item) => /^FUN-[A-F0-9]{20}$/.test(item.functionId))).toBe(true)
  })

  it('不同需求的相同功能生成不同 ID', () => {
    const first = assignFunctionIds('REQ-1', createFunctions(1))
    const second = assignFunctionIds('REQ-2', createFunctions(1))

    expect(first[0].functionId).not.toBe(second[0].functionId)
  })

  it('将功能平衡切分且任何批次不超过 12 个', () => {
    const functions = assignFunctionIds('REQ-1', createFunctions(37))
    const batches = partitionFunctionBatches(functions)

    expect(batches.map((batch) => batch.length)).toEqual([10, 9, 9, 9])
    expect(batches.every((batch) => batch.length <= 12)).toBe(true)
    expect(batches.flat().map((item) => item.functionId)).toEqual(
      functions.map((item) => item.functionId)
    )
  })

  it('拒绝超过同步上限的功能列表', () => {
    expect(() => assignFunctionIds('REQ-1', createFunctions(49)))
      .toThrow('同步功能拆解最多支持 48 个功能')
  })

  it('校验完整输出并将角色 ID 还原为角色名', () => {
    const functions = assignFunctionIds('REQ-1', createFunctions(2))
    const roles = assignRoleIds(createRoles())
    const output = createValidOutput(
      functions.map((item) => item.functionId),
      roles[0].roleId
    ).reverse()

    const result = validateRoleEffortBatch(functions, output, roles)

    expect(result.get(functions[0].functionId)).toEqual([
      { role: '后端开发', days: 1, reason: undefined },
    ])
  })

  it('拒绝缺失、重复和未知功能 ID', () => {
    const functions = assignFunctionIds('REQ-1', createFunctions(2))
    const roles = assignRoleIds(createRoles())
    const valid = createValidOutput(
      functions.map((item) => item.functionId),
      roles[0].roleId
    )

    expect(() => validateRoleEffortBatch(functions, valid.slice(0, 1), roles))
      .toThrow('预期 2 个')
    expect(() => validateRoleEffortBatch(functions, [valid[0], valid[0]], roles))
      .toThrow('重复返回功能 ID')
    expect(() => validateRoleEffortBatch(functions, [
      valid[0],
      { ...valid[1], functionId: 'FUN-FFFFFFFFFFFFFFFFFFFF' },
    ], roles)).toThrow('未知功能 ID')
  })

  it('拒绝未知角色、重复角色和非法人天', () => {
    const functions = assignFunctionIds('REQ-1', createFunctions(1))
    const roles = assignRoleIds(createRoles())
    const functionId = functions[0].functionId
    const roleId = roles[0].roleId

    expect(() => validateRoleEffortBatch(functions, [{
      functionId,
      roleEstimates: [{ roleId: 'ROLE-FFFFFFFFFFFFFFFFFFFF', days: 1 }],
    }], roles)).toThrow('未知角色 ID')

    expect(() => validateRoleEffortBatch(functions, [{
      functionId,
      roleEstimates: [
        { roleId, days: 1 },
        { roleId, days: 2 },
      ],
    }], roles)).toThrow('重复返回角色')

    expect(() => validateRoleEffortBatch(functions, [{
      functionId,
      roleEstimates: [{ roleId, days: Number.POSITIVE_INFINITY }],
    }], roles)).toThrow('必须在 0 到 120 之间')
  })

  it('按原功能顺序归并乱序批次结果', () => {
    const functions = assignFunctionIds('REQ-1', createFunctions(14))
    const roles = assignRoleIds(createRoles())
    const batches = partitionFunctionBatches(functions)
    const results = batches.map((batch) => validateRoleEffortBatch(
      batch,
      createValidOutput(batch.map((item) => item.functionId), roles[0].roleId).reverse(),
      roles
    ))

    const merged = mergeRoleEffortBatches(functions, results.reverse())

    expect(merged.map((module) => module.functionName)).toEqual(
      functions.map((item) => item.module.functionName)
    )
    expect(merged.every((module) => module.roleEstimates.length === 1)).toBe(true)
  })

  it('拒绝重复角色目录和非法角色人数', () => {
    expect(() => assignRoleIds([
      { role: '后端开发', responsibility: '开发', headcount: 1 },
      { role: '后端开发', responsibility: '开发', headcount: 1 },
    ])).toThrow('角色重复')

    expect(() => assignRoleIds([
      { role: '后端开发', responsibility: '开发', headcount: 0 },
    ])).toThrow('人数必须是 1 到 50 的整数')
  })
})

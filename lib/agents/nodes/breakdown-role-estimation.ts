import { createHash } from 'node:crypto'
import { z } from 'zod'
import type {
  AgentFunctionModule,
  IdentifiedRole,
  RoleEstimate,
} from '../state'

export const BREAKDOWN_PROTOCOL_VERSION = 'evidence_anchored_v3'
export const ROLE_EFFORT_BATCH_TARGET_SIZE = 10
export const ROLE_EFFORT_BATCH_MAX_SIZE = 12
export const ROLE_EFFORT_MAX_FUNCTIONS = 48
export const ROLE_EFFORT_MAX_ROLES = 16
export const ROLE_EFFORT_MAX_DAYS = 120

export const roleEffortBatchItemSchema = z.object({
  functionId: z.string().regex(/^FUN-[A-F0-9]{20}$/),
  roleEstimates: z.array(z.object({
    roleId: z.string().regex(/^ROLE-[A-F0-9]{20}$/),
    days: z.number().positive().max(ROLE_EFFORT_MAX_DAYS),
    reason: z.string().trim().min(1).max(300).optional(),
  })).min(1).max(ROLE_EFFORT_MAX_ROLES),
})

export type RoleEffortBatchItem = z.infer<typeof roleEffortBatchItemSchema>

export interface FunctionWithStableId {
  functionId: string
  module: AgentFunctionModule
}

export interface RoleWithStableId {
  roleId: string
  role: IdentifiedRole
}

function normalizeIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('zh-CN')
}

function createStableId(prefix: 'FUN' | 'ROLE', parts: string[]): string {
  const digest = createHash('sha256')
    .update(parts.map(normalizeIdentity).join('\0'))
    .digest('hex')
    .slice(0, 20)
    .toUpperCase()

  return `${prefix}-${digest}`
}

export function assignFunctionIds(
  requirementBaselineId: string,
  modules: AgentFunctionModule[]
): FunctionWithStableId[] {
  if (!requirementBaselineId.trim()) {
    throw new Error('需求 ID 不能为空')
  }
  if (modules.length === 0) {
    throw new Error('功能列表不能为空')
  }
  if (modules.length > ROLE_EFFORT_MAX_FUNCTIONS) {
    throw new Error(`同步功能拆解最多支持 ${ROLE_EFFORT_MAX_FUNCTIONS} 个功能`)
  }

  const seenIds = new Set<string>()

  return modules.map((module) => {
    const functionId = createStableId('FUN', [
      'batched-structured-v2',
      requirementBaselineId,
      module.moduleName,
      module.functionName,
    ])

    if (seenIds.has(functionId)) {
      throw new Error(`功能稳定 ID 冲突: ${module.moduleName}/${module.functionName}`)
    }
    seenIds.add(functionId)

    return { functionId, module }
  })
}

export function assignRoleIds(roles: IdentifiedRole[]): RoleWithStableId[] {
  if (roles.length === 0) {
    throw new Error('角色目录不能为空')
  }
  if (roles.length > ROLE_EFFORT_MAX_ROLES) {
    throw new Error(`角色目录最多支持 ${ROLE_EFFORT_MAX_ROLES} 个角色`)
  }

  const seenNames = new Set<string>()
  const seenIds = new Set<string>()

  return roles.map((role) => {
    const normalizedRole = normalizeIdentity(role.role)
    if (!normalizedRole) {
      throw new Error('角色名称不能为空')
    }
    if (role.role !== role.role.trim()) {
      throw new Error(`角色名称不能包含首尾空白: ${role.role}`)
    }
    if (!Number.isInteger(role.headcount) || role.headcount <= 0 || role.headcount > 50) {
      throw new Error(`${role.role}的人数必须是 1 到 50 的整数`)
    }
    if (seenNames.has(normalizedRole)) {
      throw new Error(`角色重复: ${role.role}`)
    }
    seenNames.add(normalizedRole)

    const roleId = createStableId('ROLE', ['role-catalog-v1', normalizedRole])
    if (seenIds.has(roleId)) {
      throw new Error(`角色稳定 ID 冲突: ${role.role}`)
    }
    seenIds.add(roleId)

    return { roleId, role }
  })
}

export function partitionFunctionBatches(
  functions: FunctionWithStableId[]
): FunctionWithStableId[][] {
  if (functions.length === 0) return []

  const batchCount = Math.ceil(functions.length / ROLE_EFFORT_BATCH_MAX_SIZE)
  const baseSize = Math.floor(functions.length / batchCount)
  const largerBatchCount = functions.length % batchCount
  const batches: FunctionWithStableId[][] = []
  let offset = 0

  for (let index = 0; index < batchCount; index++) {
    const size = baseSize + (index < largerBatchCount ? 1 : 0)
    batches.push(functions.slice(offset, offset + size))
    offset += size
  }

  return batches
}

export function validateRoleEffortBatch(
  batch: FunctionWithStableId[],
  output: RoleEffortBatchItem[],
  roles: RoleWithStableId[]
): Map<string, RoleEstimate[]> {
  const expectedIds = new Set(batch.map((item) => item.functionId))
  const allowedRoles = new Map(roles.map((item) => [item.roleId, item.role.role]))
  const result = new Map<string, RoleEstimate[]>()

  if (output.length !== batch.length) {
    throw new Error(`工时批次返回 ${output.length} 个功能，预期 ${batch.length} 个`)
  }

  for (const item of output) {
    if (!expectedIds.has(item.functionId)) {
      throw new Error(`工时批次返回未知功能 ID: ${item.functionId}`)
    }
    if (result.has(item.functionId)) {
      throw new Error(`工时批次重复返回功能 ID: ${item.functionId}`)
    }
    if (item.roleEstimates.length === 0) {
      throw new Error(`功能 ${item.functionId} 缺少角色工时`)
    }

    const seenRoleIds = new Set<string>()
    const roleEstimates = item.roleEstimates.map((estimate) => {
      const roleName = allowedRoles.get(estimate.roleId)
      if (!roleName) {
        throw new Error(`功能 ${item.functionId} 引用了未知角色 ID: ${estimate.roleId}`)
      }
      if (seenRoleIds.has(estimate.roleId)) {
        throw new Error(`功能 ${item.functionId} 重复返回角色: ${roleName}`)
      }
      if (!Number.isFinite(estimate.days) || estimate.days <= 0 || estimate.days > ROLE_EFFORT_MAX_DAYS) {
        throw new Error(`${roleName}的功能人天必须在 0 到 ${ROLE_EFFORT_MAX_DAYS} 之间`)
      }
      seenRoleIds.add(estimate.roleId)

      return {
        role: roleName,
        days: estimate.days,
        reason: estimate.reason,
      }
    })

    result.set(item.functionId, roleEstimates)
  }

  for (const expectedId of expectedIds) {
    if (!result.has(expectedId)) {
      throw new Error(`工时批次缺少功能 ID: ${expectedId}`)
    }
  }

  return result
}

export function mergeRoleEffortBatches(
  functions: FunctionWithStableId[],
  batchResults: Array<Map<string, RoleEstimate[]>>
): AgentFunctionModule[] {
  const effortByFunctionId = new Map<string, RoleEstimate[]>()

  for (const batchResult of batchResults) {
    for (const [functionId, roleEstimates] of batchResult) {
      if (effortByFunctionId.has(functionId)) {
        throw new Error(`多个批次重复返回功能 ID: ${functionId}`)
      }
      effortByFunctionId.set(functionId, roleEstimates)
    }
  }

  return functions.map(({ functionId, module }) => {
    const roleEstimates = effortByFunctionId.get(functionId)
    if (!roleEstimates) {
      throw new Error(`缺少功能工时结果: ${functionId}`)
    }

    return {
      ...module,
      roleEstimates,
    }
  })
}

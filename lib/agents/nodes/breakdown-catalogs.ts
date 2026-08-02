import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AdditionalWorkItem, IdentifiedRole } from '../state'
import {
  ROLE_EFFORT_MAX_DAYS,
  ROLE_EFFORT_MAX_ROLES,
  assignRoleIds,
  type RoleWithStableId,
} from './breakdown-role-estimation'

export const ADDITIONAL_WORK_MAX_ITEMS = 24

export const roleCatalogSchema = z.object({
  roles: z.array(z.object({
    role: z.string().trim().min(1).max(50),
    responsibility: z.string().trim().min(1).max(300),
    headcount: z.number().int().min(1).max(50),
  })).min(1).max(ROLE_EFFORT_MAX_ROLES),
})

export const additionalWorkSchema = z.object({
  items: z.array(z.object({
    workItem: z.string().trim().min(1).max(100),
    days: z.number().positive().max(ROLE_EFFORT_MAX_DAYS),
    assignedRoleIds: z.array(
      z.string().regex(/^ROLE-[A-F0-9]{20}$/)
    ).min(1).max(ROLE_EFFORT_MAX_ROLES),
    reason: z.string().trim().min(1).max(300).optional(),
  })).max(ADDITIONAL_WORK_MAX_ITEMS),
})

export type RoleCatalogOutput = z.infer<typeof roleCatalogSchema>
export type AdditionalWorkOutput = z.infer<typeof additionalWorkSchema>

export interface AdditionalWorkWithStableId {
  additionalWorkId: string
  item: AdditionalWorkItem
}

function normalizeIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('zh-CN')
}

function createAdditionalWorkId(
  requirementBaselineId: string,
  workItem: string
): string {
  const digest = createHash('sha256')
    .update([
      'additional-work-v1',
      normalizeIdentity(requirementBaselineId),
      normalizeIdentity(workItem),
    ].join('\0'))
    .digest('hex')
    .slice(0, 20)
    .toUpperCase()

  return `ADD-${digest}`
}

export function validateRoleCatalog(
  output: RoleCatalogOutput
): { roles: IdentifiedRole[]; rolesWithIds: RoleWithStableId[] } {
  const roles = output.roles.map((role) => ({
    role: role.role,
    responsibility: role.responsibility,
    headcount: role.headcount,
  }))

  return {
    roles,
    rolesWithIds: assignRoleIds(roles),
  }
}

export function validateAdditionalWork(
  requirementBaselineId: string,
  output: AdditionalWorkOutput,
  roles: RoleWithStableId[]
): AdditionalWorkWithStableId[] {
  if (!requirementBaselineId.trim()) {
    throw new Error('需求 ID 不能为空')
  }

  const roleNamesById = new Map(roles.map(({ roleId, role }) => [roleId, role.role]))
  const seenWorkItems = new Set<string>()
  const seenIds = new Set<string>()

  return output.items.map((candidate) => {
    const normalizedWorkItem = normalizeIdentity(candidate.workItem)
    if (!normalizedWorkItem) {
      throw new Error('额外工作项名称不能为空')
    }
    if (candidate.workItem !== candidate.workItem.trim()) {
      throw new Error(`额外工作项不能包含首尾空白: ${candidate.workItem}`)
    }
    if (seenWorkItems.has(normalizedWorkItem)) {
      throw new Error(`额外工作项重复: ${candidate.workItem}`)
    }
    seenWorkItems.add(normalizedWorkItem)

    if (!Number.isFinite(candidate.days) || candidate.days <= 0 || candidate.days > ROLE_EFFORT_MAX_DAYS) {
      throw new Error(`${candidate.workItem}的人天必须在 0 到 ${ROLE_EFFORT_MAX_DAYS} 之间`)
    }

    const seenRoleIds = new Set<string>()
    const assignedRoles = candidate.assignedRoleIds.map((roleId) => {
      const roleName = roleNamesById.get(roleId)
      if (!roleName) {
        throw new Error(`${candidate.workItem}引用了未知角色 ID: ${roleId}`)
      }
      if (seenRoleIds.has(roleId)) {
        throw new Error(`${candidate.workItem}重复分配角色: ${roleName}`)
      }
      seenRoleIds.add(roleId)
      return roleName
    })

    const additionalWorkId = createAdditionalWorkId(requirementBaselineId, candidate.workItem)
    if (seenIds.has(additionalWorkId)) {
      throw new Error(`额外工作稳定 ID 冲突: ${candidate.workItem}`)
    }
    seenIds.add(additionalWorkId)

    return {
      additionalWorkId,
      item: {
        workItem: candidate.workItem,
        days: candidate.days,
        assignedRoles,
      },
    }
  })
}

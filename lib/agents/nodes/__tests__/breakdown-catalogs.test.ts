import { describe, expect, it } from 'vitest'
import {
  additionalWorkSchema,
  roleCatalogSchema,
  validateAdditionalWork,
  validateRoleCatalog,
} from '../breakdown-catalogs'

function createRoleCatalog() {
  return validateRoleCatalog({
    roles: [
      { role: '后端开发', responsibility: '服务端开发', headcount: 2 },
      { role: '前端开发', responsibility: '前端开发', headcount: 1 },
      { role: '测试工程师', responsibility: '质量保障', headcount: 1 },
    ],
  })
}

describe('Breakdown 结构化目录', () => {
  it('校验角色目录并生成稳定角色 ID', () => {
    const first = createRoleCatalog()
    const second = createRoleCatalog()

    expect(first.rolesWithIds.map((item) => item.roleId)).toEqual(
      second.rolesWithIds.map((item) => item.roleId)
    )
    expect(first.rolesWithIds.every((item) => /^ROLE-[A-F0-9]{20}$/.test(item.roleId))).toBe(true)
  })

  it('Schema 拒绝空角色目录和非法角色人数', () => {
    expect(() => roleCatalogSchema.parse({ roles: [] })).toThrow()
    expect(() => roleCatalogSchema.parse({
      roles: [{ role: '开发', responsibility: '开发', headcount: 0 }],
    })).toThrow()
  })

  it('将额外工作的角色 ID 映射回角色名并生成稳定 ADD ID', () => {
    const { rolesWithIds } = createRoleCatalog()
    const output = {
      items: [{
        workItem: '架构与联调',
        days: 10,
        assignedRoleIds: [rolesWithIds[0].roleId, rolesWithIds[1].roleId],
        reason: '跨模块工作',
      }],
    }

    const first = validateAdditionalWork('REQ-1', output, rolesWithIds)
    const second = validateAdditionalWork('REQ-1', output, rolesWithIds)

    expect(first).toEqual(second)
    expect(first[0].additionalWorkId).toMatch(/^ADD-[A-F0-9]{20}$/)
    expect(first[0].item).toEqual({
      workItem: '架构与联调',
      days: 10,
      assignedRoles: ['后端开发', '前端开发'],
    })
  })

  it('允许没有额外工作', () => {
    const { rolesWithIds } = createRoleCatalog()

    expect(validateAdditionalWork('REQ-1', { items: [] }, rolesWithIds)).toEqual([])
  })

  it('拒绝重复和未知承担角色', () => {
    const { rolesWithIds } = createRoleCatalog()
    const roleId = rolesWithIds[0].roleId

    expect(() => validateAdditionalWork('REQ-1', {
      items: [{ workItem: '架构设计', days: 5, assignedRoleIds: [roleId, roleId] }],
    }, rolesWithIds)).toThrow('重复分配角色')

    expect(() => validateAdditionalWork('REQ-1', {
      items: [{
        workItem: '架构设计',
        days: 5,
        assignedRoleIds: ['ROLE-FFFFFFFFFFFFFFFFFFFF'],
      }],
    }, rolesWithIds)).toThrow('未知角色 ID')
  })

  it('拒绝规范化后重复的额外工作项', () => {
    const { rolesWithIds } = createRoleCatalog()
    const roleId = rolesWithIds[0].roleId

    expect(() => validateAdditionalWork('REQ-1', {
      items: [
        { workItem: '架构设计', days: 5, assignedRoleIds: [roleId] },
        { workItem: '架构设计', days: 3, assignedRoleIds: [roleId] },
      ],
    }, rolesWithIds)).toThrow('额外工作项重复')
  })

  it('Schema 拒绝零、负数、无限或超上限人天', () => {
    const validRoleId = createRoleCatalog().rolesWithIds[0].roleId
    const createOutput = (days: number) => ({
      items: [{ workItem: '架构设计', days, assignedRoleIds: [validRoleId] }],
    })

    expect(() => additionalWorkSchema.parse(createOutput(0))).toThrow()
    expect(() => additionalWorkSchema.parse(createOutput(-1))).toThrow()
    expect(() => additionalWorkSchema.parse(createOutput(Number.POSITIVE_INFINITY))).toThrow()
    expect(() => additionalWorkSchema.parse(createOutput(121))).toThrow()
  })
})

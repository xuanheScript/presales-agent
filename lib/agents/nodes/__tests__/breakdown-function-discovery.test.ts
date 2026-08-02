import { describe, expect, it } from 'vitest'
import {
  chunkRequirement,
  createFunctionDiscoveryEvidenceLines,
  functionDiscoverySchema,
  mergeFunctionDiscoveries,
  resolveEvidenceAnchoredFunctionDiscovery,
  validateFunctionDiscovery,
  type FunctionDiscoveryOutput,
} from '../breakdown-function-discovery'

function createDiscovery(
  sourceId: string,
  overrides: Partial<FunctionDiscoveryOutput> = {}
): FunctionDiscoveryOutput {
  return {
    sourceId,
    coverageStatus: 'functions',
    functions: [{
      moduleName: '用户模块',
      functionName: '用户登录',
      description: '用户通过手机号登录系统',
      evidenceQuote: '用户通过手机号登录系统',
    }],
    ...overrides,
  }
}

describe('Breakdown 分片功能发现', () => {
  it('按语义块确定性切片并生成稳定 SRC ID', () => {
    const requirement = [
      '# 用户模块\n用户通过手机号登录系统。',
      '# 订单模块\n用户可以创建并查询订单。',
      '# 报表模块\n管理员可以导出经营报表。',
    ].join('\n\n')
    const options = {
      targetChars: 30,
      maxChars: 80,
      targetEstimatedTokens: 100,
      maxEstimatedTokens: 200,
      overlapChars: 20,
      maxChunks: 10,
    }

    const first = chunkRequirement('REQ-1', requirement, options)
    const second = chunkRequirement('REQ-1', requirement, options)

    expect(first.length).toBeGreaterThan(1)
    expect(first).toEqual(second)
    expect(first.every((source) => /^SRC-[A-F0-9]{20}$/.test(source.sourceId))).toBe(true)
    expect(first.every((source) => source.text.length <= options.maxChars)).toBe(true)
  })

  it('不拆分有界 Markdown 列表和表格块', () => {
    const listBlock = '- 用户登录\n这是登录功能的惰性续行\n\n  登录后记录审计日志\n- 用户退出\n- 找回密码'
    const tableBlock = '| 功能 | 描述 |\n| --- | --- |\n| 登录 | 手机号登录 |'
    const sources = chunkRequirement(
      'REQ-1',
      `${listBlock}\n\n${tableBlock}`,
      {
        targetChars: 20,
        maxChars: 100,
        targetEstimatedTokens: 100,
        maxEstimatedTokens: 200,
        overlapChars: 0,
        maxChunks: 10,
      }
    )

    expect(sources.map((source) => source.text)).toEqual([listBlock, tableBlock])
  })

  it('用块级 Markdown 语法中断列表 lazy continuation', () => {
    const cases = [
      '# 后续章节',
      '> 后续引用',
      '<section>后续区块</section>',
      '::: note',
    ]

    for (const blockStart of cases) {
      const listBlock = '- 一个列表项\n这是列表项的惰性续行'
      const sources = chunkRequirement(
        'REQ-1',
        `${listBlock}\n${blockStart}\n${'普通章节内容。'.repeat(10)}`,
        {
          targetChars: 30,
          maxChars: 100,
          targetEstimatedTokens: 100,
          maxEstimatedTokens: 200,
          overlapChars: 0,
          maxChunks: 10,
        }
      )

      expect(sources[0].text).toBe(listBlock)
      expect(sources.slice(1).some((source) => source.text.includes(blockStart))).toBe(true)
    }
  })

  it('不拆分含空行的 fenced code block', () => {
    const codeBlock = '```ts\nconst first = true\n\nconst second = true\n```'
    const sources = chunkRequirement('REQ-1', codeBlock, {
      targetChars: 20,
      maxChars: 100,
      targetEstimatedTokens: 100,
      maxEstimatedTokens: 200,
      overlapChars: 0,
      maxChunks: 10,
    })

    expect(sources).toHaveLength(1)
    expect(sources[0].text).toBe(codeBlock)
  })

  it('保留原始需求的绝对 offset', () => {
    const requirement = '开头\n\n\n\n用户通过手机号登录系统。'
    const sources = chunkRequirement('REQ-1', requirement, {
      targetChars: 4,
      maxChars: 100,
      targetEstimatedTokens: 100,
      maxEstimatedTokens: 200,
      overlapChars: 0,
      maxChunks: 10,
    })
    const loginSource = sources.find((source) => source.text.includes('手机号'))

    expect(loginSource).toBeDefined()
    expect(requirement.slice(
      loginSource!.focusStartOffset,
      loginSource!.focusEndOffset
    )).toBe(loginSource!.text)
  })

  it('拒绝超过上限且不可安全拆分的 Markdown 块', () => {
    const oversizedList = Array.from({ length: 20 }, (_, index) => `- 功能${index}`).join('\n')

    expect(() => chunkRequirement('REQ-1', oversizedList, {
      targetChars: 30,
      maxChars: 50,
      targetEstimatedTokens: 100,
      maxEstimatedTokens: 200,
      overlapChars: 0,
      maxChunks: 10,
    })).toThrow('无法在不破坏结构的情况下拆分')
  })

  it('拒绝超过同步切片数量上限的需求', () => {
    const requirement = Array.from(
      { length: 5 },
      (_, index) => `第${index + 1}段。${'需求'.repeat(20)}`
    ).join('\n\n')

    expect(() => chunkRequirement('REQ-1', requirement, {
      targetChars: 20,
      maxChars: 100,
      targetEstimatedTokens: 100,
      maxEstimatedTokens: 200,
      overlapChars: 0,
      maxChunks: 2,
    })).toThrow('最多支持 2 个需求切片')
  })

  it('校验来源覆盖状态和精确证据引用', () => {
    const [source] = chunkRequirement('REQ-1', '用户通过手机号登录系统。')
    const valid = validateFunctionDiscovery(source, createDiscovery(source.sourceId))

    expect(valid.sourceId).toBe(source.sourceId)
    expect(() => validateFunctionDiscovery(source, createDiscovery(
      'SRC-FFFFFFFFFFFFFFFFFFFF'
    ))).toThrow('错误的来源 ID')
    expect(() => validateFunctionDiscovery(source, createDiscovery(source.sourceId, {
      functions: [{
        moduleName: '用户模块',
        functionName: '微信登录',
        description: '微信授权登录',
        evidenceQuote: '微信授权登录',
      }],
    }))).toThrow('证据不属于来源')
  })

  it('要求证据位于当前焦点而非重叠上下文', () => {
    const sources = chunkRequirement(
      'REQ-1',
      '用户通过手机号登录系统。\n\n用户登录后可以创建订单。',
      {
        targetChars: 20,
        maxChars: 80,
        targetEstimatedTokens: 100,
        maxEstimatedTokens: 200,
        overlapChars: 30,
        maxChunks: 10,
      }
    )

    expect(() => validateFunctionDiscovery(sources[1], createDiscovery(
      sources[1].sourceId
    ))).toThrow('当前焦点')
  })

  it('用稳定证据 ID 将模型选择确定性还原为当前焦点原文', () => {
    const [source] = chunkRequirement(
      'REQ-1',
      '4.1 数据集成\n系统需要从 ERP、MES 和 WMS 获取：\n销售订单'
    )
    const evidenceLines = createFunctionDiscoveryEvidenceLines(source)
    const selected = evidenceLines.find(
      ({ quote }) => quote === '系统需要从 ERP、MES 和 WMS 获取：'
    )
    expect(selected).toBeDefined()

    const resolved = resolveEvidenceAnchoredFunctionDiscovery(evidenceLines, {
      sourceId: source.sourceId,
      coverageStatus: 'functions',
      functions: [{
        moduleName: '数据集成',
        functionName: '获取ERP、MES和WMS数据',
        description: '获取制造业务系统数据',
        evidenceId: selected!.evidenceId,
      }],
    })

    expect(resolved.functions[0].evidenceQuote).toBe(selected!.quote)
    expect(validateFunctionDiscovery(source, resolved).functions).toHaveLength(1)
  })

  it('拒绝模型虚构的证据 ID', () => {
    const [source] = chunkRequirement('REQ-1', '用户通过手机号登录系统。')
    const evidenceLines = createFunctionDiscoveryEvidenceLines(source)

    expect(() => resolveEvidenceAnchoredFunctionDiscovery(evidenceLines, {
      sourceId: source.sourceId,
      coverageStatus: 'functions',
      functions: [{
        moduleName: '用户模块',
        functionName: '用户登录',
        description: '手机号登录',
        evidenceId: 'EVID-9999',
      }],
    })).toThrow('引用了未知证据 ID')
  })

  it('严格校验 functions 与 no_functions 的一致性', () => {
    const [source] = chunkRequirement('REQ-1', '仅说明项目背景，不包含软件功能。')

    expect(() => validateFunctionDiscovery(source, createDiscovery(source.sourceId, {
      coverageStatus: 'no_functions',
    }))).toThrow('声明无功能但返回了功能')
    expect(() => validateFunctionDiscovery(source, createDiscovery(source.sourceId, {
      coverageStatus: 'functions',
      functions: [],
    }))).toThrow('声明有功能但未返回功能')
    expect(validateFunctionDiscovery(source, createDiscovery(source.sourceId, {
      coverageStatus: 'no_functions',
      functions: [],
    })).coverageStatus).toBe('no_functions')
  })

  it('按来源顺序归并重叠切片的重复功能', () => {
    const sources = chunkRequirement(
      'REQ-1',
      '用户通过手机号登录系统。\n\n用户登录后可以创建订单。',
      {
        targetChars: 20,
        maxChars: 80,
        targetEstimatedTokens: 100,
        maxEstimatedTokens: 200,
        overlapChars: 30,
        maxChunks: 10,
      }
    )
    expect(sources).toHaveLength(2)

    const discoveries = sources.map((source, index) => validateFunctionDiscovery(
      source,
      createDiscovery(source.sourceId, {
        functions: [{
          moduleName: index === 0 ? '用户模块' : ' 用户模块 ',
          functionName: '用户登录',
          description: index === 0 ? '手机号登录' : '用户通过手机号完成安全登录',
          evidenceQuote: index === 0
            ? '用户通过手机号登录系统'
            : '用户登录后可以创建订单',
        }],
      })
    ))

    const merged = mergeFunctionDiscoveries(sources, discoveries.reverse())

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      moduleName: '用户模块',
      functionName: '用户登录',
      description: '用户通过手机号完成安全登录',
    })
  })

  it('拒绝缺失、重复来源覆盖和全部无功能', () => {
    const sources = chunkRequirement(
      'REQ-1',
      '项目背景说明。\n\n技术约束说明。',
      {
        targetChars: 10,
        maxChars: 50,
        targetEstimatedTokens: 100,
        maxEstimatedTokens: 200,
        overlapChars: 0,
        maxChunks: 10,
      }
    )
    const first = validateFunctionDiscovery(sources[0], createDiscovery(sources[0].sourceId, {
      coverageStatus: 'no_functions',
      functions: [],
    }))

    expect(() => mergeFunctionDiscoveries(sources, [first])).toThrow('预期')
    expect(() => mergeFunctionDiscoveries(sources, [first, first])).toThrow('重复覆盖来源')

    const allEmpty = sources.map((source) => validateFunctionDiscovery(
      source,
      createDiscovery(source.sourceId, {
        coverageStatus: 'no_functions',
        functions: [],
      })
    ))
    expect(() => mergeFunctionDiscoveries(sources, allEmpty)).toThrow('均未发现功能')
  })

  it('Schema 限制每片功能数量和来源 ID 格式', () => {
    const tooManyFunctions = Array.from({ length: 13 }, (_, index) => ({
      moduleName: '模块',
      functionName: `功能${index}`,
      description: '描述',
      evidenceQuote: '证据',
    }))

    expect(() => functionDiscoverySchema.parse({
      sourceId: 'invalid',
      coverageStatus: 'functions',
      functions: [],
    })).toThrow()
    expect(() => functionDiscoverySchema.parse({
      sourceId: 'SRC-FFFFFFFFFFFFFFFFFFFF',
      coverageStatus: 'functions',
      functions: tooManyFunctions,
    })).toThrow()
  })
})

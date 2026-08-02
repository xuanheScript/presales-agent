import { generateText, Output } from 'ai'
import type { RunnableConfig } from '@langchain/core/runnables'
import { defaultModelGateway, type ModelGateway } from '@/lib/ai/model-gateway'
import {
  EXECUTION_POLICY,
  getRunnableSignal,
  isAbortError,
  withAbortSignal,
} from '../execution-policy'
import { createTelemetryConfig } from '@/lib/observability/langfuse'
import { getReferencesForBreakdown, incrementReferenceUsage } from '@/app/actions/estimate-references'
import type { EstimateReference } from '@/types'
import type { PresalesState, AgentFunctionModule } from '../state'
import {
  additionalWorkSchema,
  roleCatalogSchema,
  validateAdditionalWork,
  validateRoleCatalog,
} from './breakdown-catalogs'
import {
  assignFunctionIds,
  BREAKDOWN_PROTOCOL_VERSION,
  mergeRoleEffortBatches,
  partitionFunctionBatches,
  roleEffortBatchItemSchema,
  validateRoleEffortBatch,
  type FunctionWithStableId,
  type RoleWithStableId,
} from './breakdown-role-estimation'
import {
  chunkRequirement,
  checkFunctionDiscovery,
  createFunctionDiscoveryEvidenceLines,
  evidenceAnchoredFunctionDiscoverySchema,
  mergeFunctionDiscoveries,
  resolveEvidenceAnchoredFunctionDiscovery,
  getSourceContextText,
  getSourceFocusText,
  type FunctionDiscoveryEvidenceLine,
  type RequirementSourceChunk,
  type ValidatedFunctionDiscovery,
} from './breakdown-function-discovery'


function buildFunctionDiscoveryPrompt(
  source: RequirementSourceChunk,
  state: PresalesState,
  existingFunctions: Array<{ moduleName: string; functionName: string }>,
  evidenceLines: FunctionDiscoveryEvidenceLine[]
): string {
  const contextText = getSourceContextText(source)
  const focusText = getSourceFocusText(source)
  const evidenceCatalog = evidenceLines
    .map(({ evidenceId, quote }) => `${evidenceId} | ${quote}`)
    .join('\n')
  const existingCatalog = existingFunctions.length > 0
    ? existingFunctions
      .map(({ moduleName, functionName }) => `- ${moduleName} | ${functionName}`)
      .join('\n')
    : '无，这是第一个需求切片。'

  return `从当前有界需求切片中发现可独立估算的软件功能，并返回结构化结果。

项目描述：${state.projectDescription || '未提供项目描述'}
来源 ID：${source.sourceId}
切片序号：${source.ordinal + 1}

仅供理解边界的上一切片上下文（禁止从这里返回功能或引用证据）：
---
${contextText || '无'}
---

当前必须覆盖的焦点文本：
---
${focusText}
---

当前焦点的可引用证据目录（必须通过 evidenceId 选择，不要复制或改写原文）：
---
${evidenceCatalog}
---

此前切片已经采用的功能命名目录：
${existingCatalog}

规则：
1. sourceId 必须原样返回 ${source.sourceId}。
2. 只识别“当前必须覆盖的焦点文本”能够直接支持的功能，不得从上下文或常识补充功能。
3. 每个功能返回模块名、功能名、简明描述和一个 evidenceId；evidenceId 必须来自可引用证据目录。
4. 服务端会使用 evidenceId 对应的原文作为证据，不要返回、复制或改写证据文本。
5. 同一业务功能与既有目录一致时，必须复用已有模块名和功能名；只有焦点文本明确提出新功能时才创建新名称。
6. 焦点文本有功能时 coverageStatus 返回 functions，并返回 1 到 12 个功能。
7. 焦点文本只有背景、约束或非功能要求，没有可独立估算的软件功能时，coverageStatus 返回 no_functions 且 functions 返回空数组。
8. 不要返回角色、角色工时、额外工作或来源之外的功能。`
}

export async function discoverFunctions(
  sources: RequirementSourceChunk[],
  state: PresalesState,
  signal: AbortSignal,
  modelGateway: ModelGateway,
  config?: RunnableConfig
): Promise<AgentFunctionModule[]> {
  const discoveries: ValidatedFunctionDiscovery[] = []
  const existingFunctions: Array<{ moduleName: string; functionName: string }> = []

  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]
    const evidenceLines = createFunctionDiscoveryEvidenceLines(source)
    const result = await generateText({
      model: modelGateway.model,
      output: Output.object({ schema: evidenceAnchoredFunctionDiscoverySchema }),
      maxOutputTokens: 4096,
      temperature: 0.2,
      maxRetries: modelGateway.maxRetries,
      abortSignal: signal,
      system: '你是专业的软件需求分析师。严格基于当前有界来源切片发现功能，并从服务端证据目录选择证据 ID。',
      prompt: buildFunctionDiscoveryPrompt(
        source,
        state,
        existingFunctions,
        evidenceLines
      ),
      experimental_telemetry: createTelemetryConfig('workflow-breakdown-function-discovery', {
        protocolVersion: BREAKDOWN_PROTOCOL_VERSION,
        projectId: state.projectId,
        requirementBaselineId: state.requirementBaselineId,
        executionId: String(config?.configurable?.executionId || 'none'),
        sourceId: source.sourceId,
        sourceIndex: String(index + 1),
        sourceCount: String(sources.length),
        sourceChars: String(source.text.length),
        sourceEstimatedTokens: String(source.estimatedTokens),
        evidenceLineCount: String(evidenceLines.length),
      }),
    })

    if (result.finishReason !== 'stop' || !result.output) {
      throw new Error(`功能发现切片 ${index + 1}/${sources.length} 未完整结束 (${result.finishReason})`)
    }

    const resolvedOutput = resolveEvidenceAnchoredFunctionDiscovery(
      evidenceLines,
      result.output
    )
    const validation = checkFunctionDiscovery(source, resolvedOutput)
    if (!validation.success) {
      throw new Error(validation.issue.message)
    }
    const discovery = validation.discovery

    discoveries.push(discovery)
    for (const candidate of discovery.functions) {
      const identity = `${candidate.moduleName.normalize('NFKC').trim()}\0${candidate.functionName.normalize('NFKC').trim()}`
        .toLocaleLowerCase('zh-CN')
      const exists = existingFunctions.some((item) => (
        `${item.moduleName.normalize('NFKC').trim()}\0${item.functionName.normalize('NFKC').trim()}`
          .toLocaleLowerCase('zh-CN') === identity
      ))
      if (!exists) {
        existingFunctions.push({
          moduleName: candidate.moduleName,
          functionName: candidate.functionName,
        })
      }
    }
  }

  return mergeFunctionDiscoveries(sources, discoveries)
}

function formatRoleEffortReferences(references: EstimateReference[]): string {
  if (references.length === 0) return '无可用历史参考，请根据当前功能复杂度独立评估。'

  return references.map((reference) => {
    const efforts = reference.role_estimates
      .map((estimate) => `${estimate.role}:${estimate.days}人天`)
      .join('；')
    return `- ${reference.module_name}/${reference.function_name}：${efforts || '无角色工时明细'}`
  }).join('\n')
}

function buildRoleEffortPrompt(
  batch: FunctionWithStableId[],
  roles: RoleWithStableId[],
  references: EstimateReference[]
): string {
  const roleCatalog = roles
    .map(({ roleId, role }) => `- ${roleId} | ${role.role} | ${role.responsibility}`)
    .join('\n')
  const functionCatalog = batch
    .map(({ functionId, module }) => (
      `- ${functionId} | ${module.moduleName} | ${module.functionName} | ${module.description}`
    ))
    .join('\n')

  return `你是一位专业的软件项目工时评估专家。

请只评估当前批次中每个功能的角色工时，并返回结构化数组。

## 角色目录
${roleCatalog}

## 当前功能批次
${functionCatalog}

## 历史验证工时参考
${formatRoleEffortReferences(references)}

## 规则
1. 每个输入 FUN-* 必须恰好返回一次，不得遗漏、重复或增加功能。
2. roleId 必须原样取自角色目录，不得创建新角色。
3. 每个功能至少分配一个角色，days 表示该角色完成该功能所需的人天。
4. days 必须大于 0 且不超过 120；复杂或明显偏离参考规模时填写 reason。
5. 不要返回模块名、功能名、角色名或额外工作，只通过 ID 关联。`
}

async function generateRoleCatalog(
  functions: FunctionWithStableId[],
  state: PresalesState,
  signal: AbortSignal,
  modelGateway: ModelGateway,
  config?: RunnableConfig
): Promise<{ roles: ReturnType<typeof validateRoleCatalog>['roles']; rolesWithIds: RoleWithStableId[] }> {
  const functionCatalog = functions
    .map(({ functionId, module }) => `- ${functionId} | ${module.moduleName} | ${module.functionName}`)
    .join('\n')
  const analysis = state.analysis!
  const result = await generateText({
    model: modelGateway.model,
    output: Output.object({ schema: roleCatalogSchema }),
    maxOutputTokens: 2048,
    temperature: 0.2,
    maxRetries: modelGateway.maxRetries,
    abortSignal: signal,
    system: '你是专业的软件项目团队规划专家。只返回当前项目确实需要的角色目录。',
    prompt: `根据项目信息和已发现功能生成有界角色目录。

项目描述：${state.projectDescription || '未提供'}
项目类型：${analysis.projectType}
技术栈：${analysis.techStack.join('、') || '未指定'}
非功能性需求：${JSON.stringify(analysis.nonFunctionalRequirements)}

功能目录：
${functionCatalog}

规则：
1. 只返回完成这些功能所需的角色，不得返回功能工时。
2. 角色名称清晰稳定，不要创建同义重复角色。
3. headcount 表示建议人数，必须是 1 到 50 的整数。
4. 最多返回 16 个角色。`,
    experimental_telemetry: createTelemetryConfig('workflow-breakdown-role-catalog', {
      protocolVersion: BREAKDOWN_PROTOCOL_VERSION,
      projectId: state.projectId,
      requirementBaselineId: state.requirementBaselineId,
      executionId: String(config?.configurable?.executionId || 'none'),
      functionsCount: String(functions.length),
    }),
  })

  if (result.finishReason !== 'stop' || !result.output) {
    throw new Error(`角色目录输出未完整结束 (${result.finishReason})`)
  }

  return validateRoleCatalog(result.output)
}

async function generateAdditionalWork(
  functions: FunctionWithStableId[],
  roles: RoleWithStableId[],
  state: PresalesState,
  signal: AbortSignal,
  modelGateway: ModelGateway,
  config?: RunnableConfig
) {
  const functionCatalog = functions
    .map(({ functionId, module }) => `- ${functionId} | ${module.moduleName} | ${module.functionName}`)
    .join('\n')
  const roleCatalog = roles
    .map(({ roleId, role }) => `- ${roleId} | ${role.role} | ${role.responsibility}`)
    .join('\n')
  const analysis = state.analysis!
  const result = await generateText({
    model: modelGateway.model,
    output: Output.object({ schema: additionalWorkSchema }),
    maxOutputTokens: 3072,
    temperature: 0.2,
    maxRetries: modelGateway.maxRetries,
    abortSignal: signal,
    system: '你是专业的软件项目规划专家。识别未包含在功能工时中的项目级额外工作。',
    prompt: `识别当前项目必要的非功能开发和项目级额外工作。

项目描述：${state.projectDescription || '未提供'}
项目类型：${analysis.projectType}
风险：${analysis.risks.join('；') || '无明确风险'}
非功能性需求：${JSON.stringify(analysis.nonFunctionalRequirements)}

功能目录：
${functionCatalog}

角色目录：
${roleCatalog}

规则：
1. 只返回架构设计、需求评审、联调测试、部署上线等没有包含在单功能工时中的项目级工作，避免重复计费。
2. days 是整个工作项的总人天，不是每个角色各自的人天。
3. assignedRoleIds 必须来自角色目录，同一工作项不得重复角色。
4. 如果没有必要的额外工作，返回空 items 数组。
5. 最多返回 24 项，单项不超过 120 人天。`,
    experimental_telemetry: createTelemetryConfig('workflow-breakdown-additional-work', {
      protocolVersion: BREAKDOWN_PROTOCOL_VERSION,
      projectId: state.projectId,
      requirementBaselineId: state.requirementBaselineId,
      executionId: String(config?.configurable?.executionId || 'none'),
      functionsCount: String(functions.length),
      rolesCount: String(roles.length),
    }),
  })

  if (result.finishReason !== 'stop' || !result.output) {
    throw new Error(`额外工作输出未完整结束 (${result.finishReason})`)
  }

  return validateAdditionalWork(state.requirementBaselineId, result.output, roles)
    .map(({ item }) => item)
}

async function estimateRoleEfforts(
  functions: FunctionWithStableId[],
  roles: RoleWithStableId[],
  references: EstimateReference[],
  signal: AbortSignal,
  state: PresalesState,
  modelGateway: ModelGateway,
  config?: RunnableConfig
): Promise<AgentFunctionModule[]> {
  const batches = partitionFunctionBatches(functions)
  const batchResults = []

  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]
    const result = await generateText({
      model: modelGateway.model,
      output: Output.array({
        name: 'FunctionRoleEffortBatch',
        description: '当前批次每个功能的角色工时估算',
        element: roleEffortBatchItemSchema,
      }),
      maxOutputTokens: 4096,
      temperature: 0.2,
      maxRetries: modelGateway.maxRetries,
      abortSignal: signal,
      system: '你是专业的软件项目工时评估专家。严格使用输入提供的功能 ID 和角色 ID。',
      prompt: buildRoleEffortPrompt(batch, roles, references),
      experimental_telemetry: createTelemetryConfig('workflow-breakdown-role-effort', {
        protocolVersion: BREAKDOWN_PROTOCOL_VERSION,
        projectId: state.projectId,
        requirementBaselineId: state.requirementBaselineId,
        executionId: String(config?.configurable?.executionId || 'none'),
        batchIndex: String(index + 1),
        batchCount: String(batches.length),
        functionsCount: String(batch.length),
      }),
    })

    if (result.finishReason !== 'stop' || !result.output) {
      throw new Error(`角色工时批次 ${index + 1}/${batches.length} 未完整结束 (${result.finishReason})`)
    }

    batchResults.push(validateRoleEffortBatch(batch, result.output, roles))
  }

  return mergeRoleEffortBatches(functions, batchResults)
}

/**
 * 功能拆解节点
 *
 * 使用 AI SDK 的 generateText + Output.object
 */
export async function breakdownNode(
  state: PresalesState,
  config?: RunnableConfig,
  modelGateway: ModelGateway = defaultModelGateway
): Promise<Partial<PresalesState>> {
  // 验证前置条件
  if (!state.analysis) {
    return {
      error: '缺少需求分析结果，无法进行功能拆解',
      currentStep: 'breakdown',
    }
  }

  try {
    const { functions, identifiedRoles, additionalWork, usedReferenceIds } = await withAbortSignal(
      [getRunnableSignal(config)],
      EXECUTION_POLICY.workflowNodeTimeoutMs,
      async (signal) => {
        // 参考检索、功能发现及后续调用共享同一个节点级 deadline。
        let references: EstimateReference[] = []
        let usedReferenceIds: string[] = []

        try {
          const queryText = [
            state.analysis!.projectType,
            ...(state.analysis!.keyFeatures || []),
          ]
            .filter(Boolean)
            .join(' ')

          references = await getReferencesForBreakdown(queryText, 10, { signal })

          if (references.length > 0) {
            usedReferenceIds = references.map((reference) => reference.id)
            console.log('[Agent] 注入估算参考:', {
              queryLength: queryText.length,
              referenceCount: references.length,
            })
          }
        } catch (refError) {
          if (isAbortError(refError, signal)) {
            throw refError
          }

          // 参考查询失败不阻塞主流程
          console.warn('[Agent] 获取估算参考失败，继续执行:', refError)
        }

        const sources = chunkRequirement(
          state.requirementBaselineId,
          state.canonicalRequirement
        )
        const modules = await discoverFunctions(sources, state, signal, modelGateway, config)
        const functionsWithIds = assignFunctionIds(state.requirementBaselineId, modules)
        const { roles: identifiedRoles, rolesWithIds } = await generateRoleCatalog(
          functionsWithIds,
          state,
          signal,
          modelGateway,
          config
        )
        const additionalWork = await generateAdditionalWork(
          functionsWithIds,
          rolesWithIds,
          state,
          signal,
          modelGateway,
          config
        )
        const estimatedFunctions = await estimateRoleEfforts(
          functionsWithIds,
          rolesWithIds,
          references,
          signal,
          state,
          modelGateway,
          config
        )

        return {
          functions: estimatedFunctions,
          identifiedRoles,
          additionalWork,
          usedReferenceIds,
        }
      }
    )

    // 计算总人天（功能模块 + 额外工作）
    const moduleTotalDays = functions.reduce(
      (sum, f) => sum + f.roleEstimates.reduce((s, r) => s + r.days, 0),
      0
    )
    const additionalTotalDays = additionalWork.reduce((sum, w) => sum + w.days, 0)
    const totalDays = moduleTotalDays + additionalTotalDays

    console.log('[Agent] 功能拆解完成:', {
      modulesCount: functions.length,
      rolesCount: identifiedRoles.length,
      additionalWorkCount: additionalWork.length,
      moduleTotalDays,
      additionalTotalDays,
      totalDays,
    })

    // 记录参考使用计数（fire-and-forget）
    if (usedReferenceIds.length > 0) {
      incrementReferenceUsage(usedReferenceIds).catch(() => {})
    }

    return {
      functions,
      identifiedRoles,
      additionalWork,
      currentStep: 'estimate',
      error: null,
    }
  } catch (error) {
    if (isAbortError(error, getRunnableSignal(config))) {
      throw error
    }

    console.error('[Agent] 功能拆解失败:', error)

    return {
      error: `功能拆解失败: ${error instanceof Error ? error.message : '未知错误'}`,
      currentStep: 'breakdown',
    }
  }
}

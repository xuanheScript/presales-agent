import { generateText } from 'ai'
import { defaultModel } from '@/lib/ai/config'
import { createTelemetryConfig } from '@/lib/observability/langfuse'
import { getReferencesForBreakdown, incrementReferenceUsage } from '@/app/actions/estimate-references'
import type { EstimateReference } from '@/types'
import type { PresalesState, AgentFunctionModule, IdentifiedRole, AdditionalWorkItem } from '../state'

/**
 * CSV 解析工具函数
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

/**
 * 解析 CSV 输出为结构化数据
 */
function parseBreakdownCSV(text: string): {
  identifiedRoles: IdentifiedRole[]
  modules: AgentFunctionModule[]
  additionalWork: AdditionalWorkItem[]
} {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l)

  const identifiedRoles: IdentifiedRole[] = []
  const moduleMap = new Map<string, AgentFunctionModule>()
  const additionalWork: AdditionalWorkItem[] = []

  let currentSection = ''

  for (const line of lines) {
    // 检测分区标记（支持带或不带 ### 前缀）
    if (line === 'ROLES' || line.startsWith('### ROLES') || line.startsWith('###ROLES')) {
      currentSection = 'roles'
      continue
    }
    if (line === 'MODULES' || line.startsWith('### MODULES') || line.startsWith('###MODULES')) {
      currentSection = 'modules'
      continue
    }
    if (line === 'ADDITIONAL' || line.startsWith('### ADDITIONAL') || line.startsWith('###ADDITIONAL')) {
      currentSection = 'additional'
      continue
    }

    // 跳过表头
    if (line.startsWith('角色,') || line.startsWith('模块名,') || line.startsWith('工作项,')) {
      continue
    }

    // 跳过空行和分隔符
    if (!line || line.startsWith('---') || line.startsWith('```')) {
      continue
    }

    const fields = parseCSVLine(line)

    if (currentSection === 'roles' && fields.length >= 3) {
      identifiedRoles.push({
        role: fields[0],
        responsibility: fields[1],
        headcount: parseInt(fields[2]) || 1,
      })
    } else if (currentSection === 'modules' && fields.length >= 4) {
      // 紧凑格式：模块名,功能名,描述,角色工时
      // 角色工时格式：产品经理:1;UI设计师:0.5;前端开发:2
      const [moduleName, functionName, description, roleEstimatesStr] = fields

      // 解析角色工时
      const roleEstimates = roleEstimatesStr.split(';').map(item => {
        const [role, daysStr] = item.split(':')
        return {
          role: role?.trim() || '',
          days: parseFloat(daysStr) || 0,
          reason: undefined,
        }
      }).filter(r => r.role && r.days > 0)

      moduleMap.set(`${moduleName}|${functionName}`, {
        moduleName,
        functionName,
        description,
        difficultyLevel: 'medium', // 默认值，保持类型兼容
        roleEstimates,
        dependencies: [],
      })
    } else if (currentSection === 'additional' && fields.length >= 3) {
      // 工作项,人天,角色列表
      additionalWork.push({
        workItem: fields[0],
        days: parseFloat(fields[1]) || 0,
        assignedRoles: fields[2].split(';').map(r => r.trim()).filter(r => r),
      })
    }
  }

  return {
    identifiedRoles,
    modules: Array.from(moduleMap.values()),
    additionalWork,
  }
}

/**
 * 功能拆解提示词 - CSV 格式输出
 */
const BREAKDOWN_PROMPT = `你是一位专业的软件项目工时评估专家。

根据需求文档完成以下任务，并以 CSV 格式输出结果。

## 任务
1. 识别项目所需的开发角色
2. 将项目拆解为详细的功能模块
3. 为每个功能评估各角色的工时（人天）
4. 评估额外的非功能开发工作

## 角色参考
- Web/移动应用：产品经理、UI/UX设计师、前端开发、后端开发、小程序开发、测试工程师
- 嵌入式系统：嵌入式工程师、硬件工程师、驱动开发、固件工程师、测试工程师
- 数据平台：数据工程师、ETL开发、数据分析师、后端开发、测试工程师

## 工时评估原则
| 复杂度 | 工时范围 | 判断标准 |
|-------|---------|---------|
| 简单 | 1-3人天 | 单一功能，无复杂逻辑，标准CRUD |
| 中等 | 3-8人天 | 多个子功能，有业务逻辑，需要多表关联 |
| 复杂 | 8-15人天 | 涉及多系统交互，复杂算法，第三方对接 |
| 非常复杂 | 15+人天 | 全新领域，高度定制化，核心业务逻辑 |



### 复杂度判断因素
- 是否涉及第三方API对接
- 是否有复杂业务逻辑（如分账、库存、权限）
- 是否需要多端协作
- 是否有特殊交互设计
- 是否涉及支付、安全等敏感功能
- 是否需要数据迁移或兼容


---

**项目描述**：
{projectDescription}

**原始需求文档**：
{rawRequirement}

---

## 输出格式要求

严格按以下 CSV 格式输出，不要输出任何解释文字：

### ROLES
角色,职责,人数
产品经理,需求分析原型设计,1
UI设计师,界面交互设计,1
...

### MODULES
模块名,功能名,描述,角色工时
用户模块,微信授权登录,获取微信号码完成注册,产品经理:1;UI设计师:0.5;小程序开发:2;后端开发:2;测试工程师:1
...

### ADDITIONAL
工作项,人天,角色列表
需求评审,2,产品经理
联调测试,3,前端开发;后端开发;测试工程师
...

注意：
1. 要保证拆解功能模块的完整性
2. 角色工时格式为 角色名:人天，多个角色用分号分隔
3. 每个功能的所有参与角色工时写在一行
4. 不要遗漏任何角色的工时评估

{referenceSection}`

/**
 * 将参考库数据格式化为 prompt 片段
 */
function formatReferencesForPrompt(references: EstimateReference[]): string {
  if (references.length === 0) return ''

  const lines = references.map((ref) => {
    const roleStr = ref.role_estimates
      .map((r) => `${r.role}:${r.days}`)
      .join(';')
    return `${ref.module_name},${ref.function_name},${ref.description || ''},${roleStr}`
  })

  return `
## 历史验证参考（仅供参考，请根据实际需求独立判断）

以下是历史项目中经过验证的功能工时评估，供你参考类似功能的工时规模：

模块名,功能名,描述,角色工时
${lines.join('\n')}

注意：以上仅为参考，实际工时应根据本项目具体需求和复杂度独立评估。`
}

/**
 * 功能拆解节点
 *
 * 使用 AI SDK 的 generateText + Output.object
 */
export async function breakdownNode(
  state: PresalesState
): Promise<Partial<PresalesState>> {
  // 验证前置条件
  if (!state.analysis) {
    return {
      error: '缺少需求分析结果，无法进行功能拆解',
      currentStep: 'breakdown',
    }
  }

  try {
    // 查询相关估算参考（使用 analysis 结果构造语义查询文本）
    let referenceSection = ''
    let usedReferenceIds: string[] = []

    try {
      // 用 projectType + keyFeatures 构造语义查询，比直接用 rawRequirement 更精准
      const queryText = [
        state.analysis.projectType,
        ...(state.analysis.keyFeatures || []),
      ]
        .filter(Boolean)
        .join(' ')

      const references = await getReferencesForBreakdown(queryText, 10)

      if (references.length > 0) {
        referenceSection = formatReferencesForPrompt(references)
        usedReferenceIds = references.map((r) => r.id)
        console.log('[Agent] 注入估算参考:', {
          queryText: queryText.substring(0, 100),
          referenceCount: references.length,
        })
      }
    } catch (refError) {
      // 参考查询失败不阻塞主流程
      console.warn('[Agent] 获取估算参考失败，继续执行:', refError)
    }

    // 构建提示词
    // 注意：不注入 analysis 结果到 breakdown 提示词中
    // 当需求文档详细时，analysis 的摘要会产生锚定效应，导致功能拆解偏粗
    // breakdownNode 直接基于 rawRequirement 拆解，能获得更准确的粒度
    const prompt = BREAKDOWN_PROMPT
      .replace('{projectDescription}', state.projectDescription || '未提供项目描述')
      .replace('{rawRequirement}', state.rawRequirement)
      .replace('{referenceSection}', referenceSection)

    // 调用 AI 模型进行功能拆解（CSV 格式）
    const result = await generateText({
      model: defaultModel,
      maxOutputTokens: 8192,
      temperature: 0.3, // 低温度，更稳定的输出
      system: `你是一个专业的软件项目工时评估专家。严格按照要求的 CSV 格式输出，不要输出任何解释文字。`,
      prompt,
      experimental_telemetry: createTelemetryConfig('workflow-breakdown', {
        projectId: state.projectId,
        requirementId: state.requirementId,
      }),
    })

    // 调试：打印模型返回的完整结果
    console.log('[Agent] generateText 返回结果:', {
      textLength: result.text?.length,
      finishReason: result.finishReason,
      usage: result.usage,
    })

    // 打印原始 CSV 输出
    if (result.text) {
      console.log('[Agent] 模型 CSV 输出 (前2000字符):', result.text.substring(0, 2000))
    }

    // 解析 CSV 输出
    if (!result.text) {
      return {
        error: '功能拆解未返回有效结果',
        currentStep: 'breakdown',
      }
    }

    const parsed = parseBreakdownCSV(result.text)

    // 验证输出
    if (parsed.modules.length === 0) {
      console.error('[Agent] CSV 解析结果为空，原始文本:', result.text)
      return {
        error: '功能拆解 CSV 解析失败，未找到功能模块',
        currentStep: 'breakdown',
      }
    }

    const functions = parsed.modules
    const identifiedRoles = parsed.identifiedRoles
    const additionalWork = parsed.additionalWork

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
    console.error('[Agent] 功能拆解失败:', error)

    return {
      error: `功能拆解失败: ${error instanceof Error ? error.message : '未知错误'}`,
      currentStep: 'breakdown',
    }
  }
}

import type { ElicitationCollectedInfo } from '@/types'
import { getCollectedInfoSummary, getCollectedFieldsCount } from './progress'

export interface ElicitationPromptContext {
  collectedInfo: ElicitationCollectedInfo
  currentRound: number
  maxRounds: number
  userInitialInput?: string
  rawRequirement?: string // 原始需求文本
}

/**
 * 生成 Elicitation 模式的系统提示词
 * 新版本：支持动态问题生成和选项式回答
 */
export function buildElicitationSystemPrompt(context: ElicitationPromptContext): string {
  const { collectedInfo, currentRound, maxRounds, userInitialInput, rawRequirement } = context
  const collectedSummary = getCollectedInfoSummary(collectedInfo)
  const { filled, total } = getCollectedFieldsCount(collectedInfo)

  return `你是一位专业的需求分析师，正在通过结构化提问引导用户完善项目需求。

## 你的目标
通过有针对性的提问，逐步收集完整的项目需求信息。每次提问都需要使用 generateQuestions 工具生成结构化的问题，让用户通过选择选项来回答。

## 当前状态
- 已收集 ${filled.length}/${total} 个关键信息类别
- 当前轮次: 第 ${currentRound} 轮 / 最多 ${maxRounds} 轮

## 已收集的信息
${collectedSummary}

${rawRequirement ? `## 用户的原始需求描述
${rawRequirement}` : ''}

${userInitialInput ? `## 用户本轮输入
${userInitialInput}` : ''}

## 工作流程
1. **分析现有信息**：仔细阅读已收集的信息和用户的原始需求
2. **识别缺失信息**：判断还需要确认哪些关键信息
3. **生成问题**：使用 generateQuestions 工具生成 1-4 个结构化问题
4. **等待用户回答**：用户会通过选择选项来回答
5. **保存信息**：根据用户的选择，使用 updateCollectedInfo 工具保存信息
6. **判断完成**：当信息足够完整时，使用 completeElicitation 工具结束引导

## 提问原则
1. 每次生成 1-4 个相关问题，不要一次问太多
2. 每个问题提供 2-4 个选项，选项要具体、互斥
3. 对于可能需要自定义输入的问题，设置 allowCustom: true
4. 问题要针对性强，避免空泛
5. 优先询问核心信息：项目类型、业务目标、核心功能、目标用户
6. 根据项目类型调整后续问题的方向

## 完成条件
当核心信息都已明确时，可以考虑结束引导。

## 回复格式
每次回复都应该：
1. 简短总结（1-2句话）你对当前需求的理解或上一轮收集到的信息
2. 然后调用 generateQuestions 工具生成结构化问题

不要直接用纯文本提问，必须使用工具生成问题。`
}

/**
 * 生成首轮提问的提示词（当用户点击开始引导时）
 */
export function buildFirstRoundPrompt(rawRequirement?: string): string {
  if (rawRequirement && rawRequirement.trim().length > 0) {
    return `用户已经提供了初始的需求描述，请分析这段描述，然后生成针对性的问题来补充和确认关键信息。

用户的需求描述：
"${rawRequirement}"

请：
1. 先简短说明你对需求的初步理解
2. 然后使用 generateQuestions 工具生成 1-4 个问题来确认和补充关键信息`
  }

  return `用户还没有提供任何项目信息，请开始需求引导。

使用 generateQuestions 工具生成 1-4 个开场问题，了解：
1. 这是什么类型的项目
2. 主要想解决什么问题或实现什么目标
3. 目标用户是谁

用友好、专业的语气开场。`
}

/**
 * 生成处理用户回答的提示词
 */
export function buildAnswerProcessingPrompt(
  answers: Array<{ questionId: string; selectedOptions: string[]; customInput?: string }>,
  questions: Array<{ id: string; question: string; fieldKey?: string }>
): string {
  const answerDetails = answers.map(answer => {
    const question = questions.find(q => q.id === answer.questionId)
    return {
      question: question?.question || '未知问题',
      fieldKey: question?.fieldKey,
      selectedOptions: answer.selectedOptions,
      customInput: answer.customInput,
    }
  })

  return `用户已回答了以下问题：

${answerDetails.map(a => `问题: ${a.question}
用户选择: ${a.selectedOptions.join('、')}${a.customInput ? `\n补充说明: ${a.customInput}` : ''}`).join('\n\n')}

请：
1. 使用 updateCollectedInfo 工具保存用户提供的信息
2. 根据用户的回答，判断是否需要继续提问
3. 如果需要继续，使用 generateQuestions 工具生成新的问题
4. 如果信息已经足够完整，使用 completeElicitation 工具结束引导`
}

/**
 * 生成完成确认提示词
 */
export function buildCompletionConfirmPrompt(collectedInfo: ElicitationCollectedInfo): string {
  const summary = getCollectedInfoSummary(collectedInfo)

  return `需求引导即将结束。请向用户确认已收集的信息：

## 已收集信息汇总
${summary}

请：
1. 用简洁的语言总结已收集的关键信息
2. 询问用户是否有补充或修改
3. 确认后调用 completeElicitation 工具结束引导`
}

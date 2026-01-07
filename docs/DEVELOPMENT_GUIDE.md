# 开发步骤指南

> 本文档详细描述了售前成本估算 Agent 系统的开发步骤和任务清单

## 📋 开发阶段概览

| 阶段 | 时间 | 主要任务 | 状态 |
|------|------|----------|------|
| 阶段 0 | 已完成 | 项目初始化和基础配置 | ✅ |
| 阶段 1 | 已完成 | 基础设施搭建 | ✅ |
| 阶段 2 | 第 3-5 周 | 核心功能开发 | ✅ |
| 阶段 3 | 第 6-7 周 | 高级功能开发 | ✅ |
| 阶段 4 | 第 8 周 | 测试和优化 | ⏳ |

---

## ✅ 阶段 0: 项目初始化（已完成）

### 任务清单

- [x] 创建 Next.js 15 项目
- [x] 安装所有依赖包（pnpm）
- [x] 配置 Tailwind CSS 4
- [x] 初始化 Shadcn UI
- [x] 创建项目目录结构
- [x] 配置环境变量模板
- [x] 创建 Supabase 客户端配置
- [x] 创建 AI SDK 配置
- [x] 定义 TypeScript 类型
- [x] 创建常量配置
- [x] 编写数据库 Schema
- [x] 创建功能库种子数据
- [x] 编写项目规划文档

### 已完成文件

```
✓ .env.local.example
✓ lib/supabase/client.ts
✓ lib/supabase/server.ts
✓ lib/ai/config.ts
✓ lib/utils.ts
✓ types/index.ts
✓ constants/index.ts
✓ components.json
✓ docs/PROJECT_PLAN.md
✓ docs/DEVELOPMENT_GUIDE.md
✓ docs/database-schema.sql
✓ docs/function-library-seed.sql
```

---

## ✅ 阶段 1: 基础设施搭建（已完成）

### 1.1 Supabase 数据库设置

**优先级**: 🔴 高

**任务**:
1. 创建 Supabase 项目
2. 执行 `docs/database-schema.sql` 创建所有表
3. 执行 `docs/function-library-seed.sql` 初始化功能库
4. 配置 Row Level Security (RLS) 策略
5. 创建 Storage bucket: `requirement-documents`
6. 测试数据库连接

**验收标准**:
- [x] 所有表创建成功
- [x] RLS 策略生效
- [x] Storage bucket 可用
- [x] 可通过 Supabase 客户端读写数据

**文件**:
- 配置文件: `.env.local`

---

### 1.2 认证系统集成

**优先级**: 🔴 高

**任务**:
1. 配置 Supabase Auth
2. 创建登录页面 `app/(auth)/login/page.tsx`
3. 创建注册页面 `app/(auth)/register/page.tsx`
4. 实现 Server Actions 处理登录/注册
   - `app/actions/auth.ts`
5. 创建中间件保护路由 `middleware.ts`
6. 实现用户 profile 自动创建（trigger）

**验收标准**:
- [x] 用户可以注册
- [x] 用户可以登录
- [x] 未登录用户访问保护页面会重定向到登录页
- [x] 登录后自动创建 profile 记录

**文件**:
```
app/
  (auth)/
    login/
      page.tsx
    register/
      page.tsx
  actions/
    auth.ts
middleware.ts
```

---

### 1.3 基础 UI 组件安装

**优先级**: 🟡 中

**任务**:
1. 安装所需的 Shadcn UI 组件：
   ```bash
   pnpm dlx shadcn@latest add button card input textarea form table dialog dropdown-menu select tabs badge separator progress sonner label avatar sheet scroll-area skeleton
   ```

2. 测试所有组件可用

**验收标准**:
- [x] 所有组件安装成功
- [x] 组件样式正常

---

### 1.4 布局组件开发

**优先级**: 🟡 中

**任务**:
1. 创建主布局 `app/layout.tsx`
2. 创建侧边栏组件 `components/layout/sidebar.tsx`
3. 创建头部组件 `components/layout/header.tsx`
4. 创建导航菜单配置 `constants/navigation.ts`
5. 实现响应式布局

**验收标准**:
- [x] 侧边栏显示导航菜单
- [x] 头部显示用户信息和退出按钮
- [x] 移动端侧边栏可折叠
- [x] 路由切换正常

**文件**:
```
app/
  layout.tsx
  (dashboard)/
    layout.tsx
components/
  layout/
    sidebar.tsx
    header.tsx
constants/
  navigation.ts
```

---

### 1.5 仪表盘页面

**优先级**: 🟢 低

**任务**:
1. 创建仪表盘页面 `app/(dashboard)/dashboard/page.tsx`
2. 显示统计数据：
   - 项目总数
   - 本月新增项目
   - 总报价金额
   - 平均工时
3. 显示最近项目列表
4. 快速操作入口（新建项目）

**验收标准**:
- [x] 统计数据展示正常
- [x] 最近项目列表可点击查看详情

**文件**:
```
app/
  (dashboard)/
    dashboard/
      page.tsx
```

---

## ✅ 阶段 2: 核心功能开发 

### 2.1 项目管理基础

**优先级**: 🔴 高

#### 2.1.1 项目列表页 ✅

**任务**:
1. 创建项目列表页 `app/(dashboard)/projects/page.tsx`
2. 实现 Server Actions:
   - `app/actions/projects.ts`
     - `getProjects()` - 获取项目列表
     - `createProject()` - 创建项目
     - `deleteProject()` - 删除项目
     - `updateProject()` - 更新项目
     - `archiveProject()` - 归档项目
3. 实现搜索和筛选（按状态、行业）
4. 实现分页
5. 添加"新建项目"按钮

**验收标准**:
- [x] 显示用户创建的所有项目
- [x] 可搜索项目名称
- [x] 可按状态筛选
- [x] 分页正常工作

**已完成文件**:
```
app/actions/projects.ts
app/(dashboard)/projects/page.tsx
components/project/project-list.tsx
components/project/project-card.tsx
```

---

#### 2.1.2 新建项目页 ✅

**任务**:
1. 创建新建项目页 `app/(dashboard)/projects/new/page.tsx`
2. 创建项目表单组件 `components/project/project-form.tsx`
3. 表单字段：
   - 项目名称（必填）
   - 项目描述
   - 行业选择（下拉）
4. 使用 useActionState 处理表单
5. 创建成功后跳转到项目详情页

**验收标准**:
- [x] 表单验证正常
- [x] 创建成功后跳转
- [x] 显示错误提示

**已完成文件**:
```
app/(dashboard)/projects/new/page.tsx
components/project/project-form.tsx
```

---

#### 2.1.3 项目详情页（布局） ✅

**任务**:
1. 创建项目详情布局 `app/(dashboard)/projects/[id]/layout.tsx`
2. 显示项目基本信息
3. 创建标签页导航：
   - 需求输入
   - 功能明细
   - 成本估算
   - 报告预览
4. 添加操作按钮（编辑、删除、归档）

**验收标准**:
- [x] 标签页切换正常
- [x] 项目信息展示正确
- [x] 操作按钮功能正常

**已完成文件**:
```
app/(dashboard)/projects/[id]/layout.tsx
app/(dashboard)/projects/[id]/page.tsx
app/(dashboard)/projects/[id]/edit/page.tsx
```

---

### 2.2 需求输入模块

**优先级**: 🔴 高

#### 2.2.1 文本输入方式 ✅

**任务**:
1. 创建需求输入页 `app/(dashboard)/projects/[id]/page.tsx`（集成在项目详情页）
2. 创建需求输入组件 `components/project/requirement-input.tsx`
3. 实现 Server Actions:
   - `app/actions/requirements.ts`
     - `createRequirement()` - 保存需求
     - `getRequirements()` - 获取需求列表
     - `updateRequirement()` - 更新需求
     - `getLatestRequirement()` - 获取最新需求
4. 添加"开始分析"按钮

**验收标准**:
- [x] 可以输入需求文本
- [x] 需求保存成功
- [x] 点击"开始分析"触发 Agent（待 Agent 实现）

**已完成文件**:
```
app/actions/requirements.ts
components/project/requirement-input.tsx
```

---

#### 2.2.2 文档上传方式 ✅

**任务**:
1. 创建文件上传组件 `components/project/file-upload.tsx`
2. 集成 Supabase Storage
3. 实现文档解析：
   - `lib/utils/document-parser.ts`
     - Word 解析（mammoth）
     - PDF 解析（pdf-parse）
4. 解析后自动填充到文本编辑器

**验收标准**:
- [x] 可以上传 Word 和 PDF
- [x] 文档内容解析正确
- [x] 解析失败有错误提示

**文件**:
```
components/
  project/
    file-upload.tsx
lib/
  utils/
    document-parser.ts
```

---

### 2.3 Agent 工作流实现（AI SDK + LangGraph） ✅

**优先级**: 🔴 高

> 📦 **技术选型**: 使用 **AI SDK + LangGraph** 构建真正的 Agent 工作流，获得状态图、条件分支、可持久化等高级能力。

#### 2.3.0 LangGraph 依赖安装

**任务**:
```bash
# 安装 LangGraph 相关依赖
pnpm add @ai-sdk/langchain @langchain/langgraph @langchain/core @langchain/openai
```

**架构图**:
```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js API Route                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              LangGraph StateGraph                        ││
│  │                                                          ││
│  │  ┌──────────┐   ┌──────────┐   ┌──────────┐            ││
│  │  │ 需求分析 │ → │ 功能拆解 │ → │ 工时评估 │            ││
│  │  └──────────┘   └──────────┘   └──────────┘            ││
│  │       ↓              ↓              ↓                   ││
│  │  ┌──────────────────────────────────────────┐          ││
│  │  │           Tools (查询功能库)              │          ││
│  │  └──────────────────────────────────────────┘          ││
│  │                      ↓                                  ││
│  │               ┌──────────┐                              ││
│  │               │ 成本计算 │                              ││
│  │               └──────────┘                              ││
│  └─────────────────────────────────────────────────────────┘│
│                         ↓                                    │
│              toUIMessageStream()                             │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                    React Frontend                            │
│                   useChat() hook                             │
└─────────────────────────────────────────────────────────────┘
```

---

#### 2.3.1 定义 Agent 状态 (State) ✅

**任务**:
1. 创建 Agent 状态类型定义 `lib/agents/state.ts`
2. 定义工作流各阶段的数据结构
3. 使用 LangGraph 的 `Annotation` 定义状态

**代码示例**:
```typescript
// lib/agents/state.ts
import { Annotation, MessagesAnnotation } from '@langchain/langgraph'
import type { ParsedRequirement, FunctionModule, EffortEstimation, CostEstimate } from '@/types'

// 定义 Agent 工作流状态
export const PresalesStateAnnotation = Annotation.Root({
  // 继承消息历史
  ...MessagesAnnotation.spec,

  // 项目信息
  projectId: Annotation<string>,
  requirementId: Annotation<string>,

  // 原始需求
  rawRequirement: Annotation<string>,

  // 各阶段输出
  analysis: Annotation<ParsedRequirement | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),
  functions: Annotation<FunctionModule[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),
  estimation: Annotation<EffortEstimation | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),
  cost: Annotation<CostEstimate | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),

  // 工作流控制
  currentStep: Annotation<'analyze' | 'breakdown' | 'estimate' | 'calculate' | 'complete'>({
    default: () => 'analyze',
  }),
  error: Annotation<string | null>({
    default: () => null,
  }),
})

export type PresalesState = typeof PresalesStateAnnotation.State
```

**验收标准**:
- [x] 状态类型定义完整
- [x] 包含所有必要的工作流数据

**文件**:
```
lib/
  agents/
    state.ts
```

---

#### 2.3.2 需求分析节点 (Analyze Node) ✅

**任务**:
1. 实现需求分析节点 `lib/agents/nodes/analyze.ts`
2. 使用 AI SDK 的 `generateText()` + `Output.object()`
3. 返回结构化分析结果并更新状态

**代码示例**:
```typescript
// lib/agents/nodes/analyze.ts
import { generateText, Output } from 'ai'
import { defaultModel } from '@/lib/ai/config'
import { z } from 'zod'
import type { PresalesState } from '../state'

const requirementSchema = z.object({
  projectType: z.string().describe('项目类型'),
  businessGoals: z.array(z.string()).describe('业务目标'),
  keyFeatures: z.array(z.string()).describe('核心功能'),
  techStack: z.array(z.string()).describe('技术栈'),
  nonFunctionalRequirements: z.object({
    performance: z.string().optional().describe('性能要求'),
    security: z.string().optional().describe('安全要求'),
    scalability: z.string().optional().describe('扩展性要求'),
  }),
  risks: z.array(z.string()).describe('潜在风险'),
})

export async function analyzeNode(state: PresalesState): Promise<Partial<PresalesState>> {
  try {
    const { output } = await generateText({
      model: defaultModel,
      output: Output.object({
        schema: requirementSchema,
      }),
      prompt: `你是资深售前顾问。分析以下需求并提取关键信息：

${state.rawRequirement}`,
    })

    return {
      analysis: output,
      currentStep: 'breakdown',
    }
  } catch (error) {
    return {
      error: `需求分析失败: ${error instanceof Error ? error.message : '未知错误'}`,
    }
  }
}
```

**验收标准**:
- [x] 成功调用 AI SDK
- [x] 返回结构化数据
- [x] 错误处理完善

**文件**:
```
lib/
  agents/
    nodes/
      analyze.ts
```

---

#### 2.3.3 功能拆解节点 (Breakdown Node) ✅

**任务**:
1. 实现功能拆解节点 `lib/agents/nodes/breakdown.ts`
2. 使用 `generateText()` + `tool()` + `stepCountIs()` 实现多步骤工具调用
3. 定义 Tool: `searchFunctionLibrary` 查询功能库

**代码示例**:
```typescript
// lib/agents/nodes/breakdown.ts
import { generateText, Output, tool, stepCountIs } from 'ai'
import { defaultModel } from '@/lib/ai/config'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import type { PresalesState } from '../state'

const functionModulesSchema = z.object({
  modules: z.array(z.object({
    moduleName: z.string().describe('模块名称'),
    functionName: z.string().describe('功能名称'),
    description: z.string().describe('功能描述'),
    difficultyLevel: z.enum(['simple', 'medium', 'complex', 'very_complex']),
    estimatedHours: z.number().describe('估算工时'),
    dependencies: z.array(z.string()).optional(),
  })),
})

export async function breakdownNode(state: PresalesState): Promise<Partial<PresalesState>> {
  if (!state.analysis) {
    return { error: '缺少需求分析结果' }
  }

  try {
    const supabase = await createClient()

    const { output } = await generateText({
      model: defaultModel,
      tools: {
        searchFunctionLibrary: tool({
          description: '从功能库搜索相似功能及标准工时',
          inputSchema: z.object({
            functionName: z.string().describe('功能名称关键词'),
            category: z.string().optional().describe('功能分类'),
          }),
          execute: async ({ functionName, category }) => {
            let query = supabase
              .from('function_library')
              .select('*')
              .ilike('function_name', `%${functionName}%`)

            if (category) {
              query = query.eq('category', category)
            }

            const { data } = await query.limit(3)
            return data || []
          },
        }),
      },
      output: Output.object({
        schema: functionModulesSchema,
      }),
      stopWhen: stepCountIs(10),
      prompt: `你是资深架构师。根据以下需求分析结果，拆解为功能模块清单。
请使用 searchFunctionLibrary 工具查询功能库中的标准功能和工时参考。

需求分析：
${JSON.stringify(state.analysis, null, 2)}`,
    })

    return {
      functions: output?.modules || [],
      currentStep: 'estimate',
    }
  } catch (error) {
    return {
      error: `功能拆解失败: ${error instanceof Error ? error.message : '未知错误'}`,
    }
  }
}
```

**验收标准**:
- [x] Agent 可以调用功能库工具
- [x] 返回结构化功能清单
- [x] Tool Calling 正常工作

**文件**:
```
lib/
  agents/
    nodes/
      breakdown.ts
```

---

#### 2.3.4 工时评估节点 (Estimate Node) ✅

**任务**:
1. 实现工时评估节点 `lib/agents/nodes/estimate.ts`
2. 基于功能库标准工时和难度系数计算
3. 生成人员配置建议

**代码示例**:
```typescript
// lib/agents/nodes/estimate.ts
import { generateText, Output } from 'ai'
import { defaultModel } from '@/lib/ai/config'
import { z } from 'zod'
import { DIFFICULTY_MULTIPLIERS } from '@/constants'
import type { PresalesState } from '../state'

const estimationSchema = z.object({
  totalHours: z.number(),
  breakdown: z.object({
    development: z.number(),
    testing: z.number(),
    integration: z.number(),
  }),
  teamComposition: z.array(z.object({
    role: z.string(),
    count: z.number(),
    duration: z.number(),
  })),
})

export async function estimateNode(state: PresalesState): Promise<Partial<PresalesState>> {
  if (!state.functions.length) {
    return { error: '缺少功能模块列表' }
  }

  try {
    // 计算基础工时
    const baseHours = state.functions.reduce((sum, fn) => {
      const multiplier = DIFFICULTY_MULTIPLIERS[fn.difficulty_level] || 1
      return sum + fn.estimated_hours * multiplier
    }, 0)

    const { output } = await generateText({
      model: defaultModel,
      output: Output.object({
        schema: estimationSchema,
      }),
      prompt: `你是项目经理。基于以下功能模块，生成工时评估和人员配置建议。
基础工时: ${baseHours} 小时

功能模块:
${JSON.stringify(state.functions, null, 2)}`,
    })

    return {
      estimation: output,
      currentStep: 'calculate',
    }
  } catch (error) {
    return {
      error: `工时评估失败: ${error instanceof Error ? error.message : '未知错误'}`,
    }
  }
}
```

**验收标准**:
- [x] 工时计算准确
- [x] 人员配置合理

**文件**:
```
lib/
  agents/
    nodes/
      estimate.ts
```

---

#### 2.3.5 成本计算节点 (Calculate Node) ✅

**任务**:
1. 实现成本计算节点 `lib/agents/nodes/calculate.ts`
2. 计算人力成本、服务成本、基础设施成本
3. 应用风险缓冲，返回完整成本报告

**代码示例**:
```typescript
// lib/agents/nodes/calculate.ts
import { DEFAULT_CONFIG } from '@/constants'
import type { PresalesState } from '../state'

export async function calculateNode(state: PresalesState): Promise<Partial<PresalesState>> {
  if (!state.estimation) {
    return { error: '缺少工时评估结果' }
  }

  try {
    const { totalHours, breakdown, teamComposition } = state.estimation

    // 计算人力成本
    const workDays = Math.ceil(totalHours / DEFAULT_CONFIG.WORKING_HOURS_PER_DAY)
    const laborCost = workDays * DEFAULT_CONFIG.LABOR_COST_PER_DAY

    // 计算风险缓冲
    const bufferAmount = laborCost * (DEFAULT_CONFIG.RISK_BUFFER_PERCENTAGE / 100)

    // 总成本
    const totalCost = laborCost + bufferAmount

    const costEstimate = {
      labor_cost: laborCost,
      service_cost: 0, // 可根据需求添加第三方服务成本
      infrastructure_cost: 0, // 可根据需求添加基础设施成本
      buffer_percentage: DEFAULT_CONFIG.RISK_BUFFER_PERCENTAGE,
      total_cost: totalCost,
      breakdown: {
        development: breakdown.development * DEFAULT_CONFIG.LABOR_COST_PER_DAY / DEFAULT_CONFIG.WORKING_HOURS_PER_DAY,
        testing: breakdown.testing * DEFAULT_CONFIG.LABOR_COST_PER_DAY / DEFAULT_CONFIG.WORKING_HOURS_PER_DAY,
        deployment: 0,
        maintenance: 0,
        thirdPartyServices: [],
      },
    }

    return {
      cost: costEstimate,
      currentStep: 'complete',
    }
  } catch (error) {
    return {
      error: `成本计算失败: ${error instanceof Error ? error.message : '未知错误'}`,
    }
  }
}
```

**验收标准**:
- [x] 成本计算准确
- [x] 包含明细分解

**文件**:
```
lib/
  agents/
    nodes/
      calculate.ts
```

---

#### 2.3.6 LangGraph 工作流编排 ✅

**任务**:
1. 创建 LangGraph 状态图 `lib/agents/graph.ts`
2. 定义节点和边的连接关系
3. 添加条件路由（错误处理）
4. 编译并导出工作流

**代码示例**:
```typescript
// lib/agents/graph.ts
import { StateGraph, START, END } from '@langchain/langgraph'
import { PresalesStateAnnotation } from './state'
import { analyzeNode } from './nodes/analyze'
import { breakdownNode } from './nodes/breakdown'
import { estimateNode } from './nodes/estimate'
import { calculateNode } from './nodes/calculate'

// 条件路由：检查是否有错误
function shouldContinue(state: typeof PresalesStateAnnotation.State) {
  if (state.error) {
    return 'error'
  }
  return state.currentStep
}

// 创建工作流图
const workflow = new StateGraph(PresalesStateAnnotation)
  // 添加节点
  .addNode('analyze', analyzeNode)
  .addNode('breakdown', breakdownNode)
  .addNode('estimate', estimateNode)
  .addNode('calculate', calculateNode)

  // 定义边
  .addEdge(START, 'analyze')
  .addConditionalEdges('analyze', shouldContinue, {
    breakdown: 'breakdown',
    error: END,
  })
  .addConditionalEdges('breakdown', shouldContinue, {
    estimate: 'estimate',
    error: END,
  })
  .addConditionalEdges('estimate', shouldContinue, {
    calculate: 'calculate',
    error: END,
  })
  .addConditionalEdges('calculate', shouldContinue, {
    complete: END,
    error: END,
  })

// 编译工作流
export const presalesGraph = workflow.compile()

// 运行工作流的辅助函数
export async function runPresalesWorkflow(
  projectId: string,
  requirementId: string,
  rawRequirement: string
) {
  const initialState = {
    projectId,
    requirementId,
    rawRequirement,
    messages: [],
  }

  const finalState = await presalesGraph.invoke(initialState)

  return {
    analysis: finalState.analysis,
    functions: finalState.functions,
    estimation: finalState.estimation,
    cost: finalState.cost,
    error: finalState.error,
  }
}
```

**工作流图示**:
```
        ┌─────────┐
        │  START  │
        └────┬────┘
             ↓
        ┌─────────┐
        │ analyze │ ──────────────────┐
        └────┬────┘                   │
             ↓ (成功)                  ↓ (错误)
        ┌──────────┐              ┌─────┐
        │breakdown │ ────────────→│ END │
        └────┬─────┘              └─────┘
             ↓ (成功)                  ↑
        ┌──────────┐                  │
        │ estimate │ ─────────────────┤
        └────┬─────┘                  │
             ↓ (成功)                  │
        ┌───────────┐                 │
        │ calculate │ ────────────────┘
        └─────┬─────┘
              ↓ (完成)
        ┌─────────┐
        │   END   │
        └─────────┘
```

**验收标准**:
- [x] 工作流按状态图执行
- [x] 条件路由正确处理错误
- [x] 可以完整执行整个流程

**文件**:
```
lib/
  agents/
    graph.ts
    state.ts
    nodes/
      analyze.ts
      breakdown.ts
      estimate.ts
      calculate.ts
      index.ts
```

---

### 2.4 实时流式展示 ✅

**优先级**: 🟡 中

#### 2.4.1 LangGraph 流式 API Route ✅

**任务**:
1. 创建 API Route 集成 LangGraph 工作流
2. 使用 `@ai-sdk/langchain` 适配器转换消息和流
3. 返回流式响应给前端

**代码示例**:
```typescript
// app/api/agent/workflow/route.ts
import { toBaseMessages, toUIMessageStream } from '@ai-sdk/langchain'
import { createUIMessageStreamResponse, UIMessage } from 'ai'
import { presalesGraph } from '@/lib/agents/graph'
import { createClient } from '@/lib/supabase/server'
import { getRequirement } from '@/app/actions/requirements'

export const maxDuration = 60 // 允许最长 60 秒执行

export async function POST(req: Request) {
  const { projectId, requirementId }: { projectId: string, requirementId: string } = await req.json()

  // 获取需求内容
  const requirement = await getRequirement(requirementId)
  if (!requirement) {
    return Response.json({ error: '需求不存在' }, { status: 404 })
  }

  // 初始化状态
  const initialState = {
    projectId,
    requirementId,
    rawRequirement: requirement.raw_content,
    messages: [],
  }

  // 使用 LangGraph 流式执行工作流
  const stream = await presalesGraph.stream(
    initialState,
    { streamMode: ['values', 'messages'] }
  )

  // 转换为 AI SDK 流式响应
  return createUIMessageStreamResponse({
    stream: toUIMessageStream(stream),
  })
}
```

**非流式 API (用于一次性执行)**:
```typescript
// app/api/agent/run/route.ts
import { presalesGraph, runPresalesWorkflow } from '@/lib/agents/graph'
import { createClient } from '@/lib/supabase/server'
import { getRequirement } from '@/app/actions/requirements'
import { updateRequirementAnalysis } from '@/app/actions/requirements'

export async function POST(req: Request) {
  const { projectId, requirementId }: { projectId: string, requirementId: string } = await req.json()

  // 获取需求内容
  const requirement = await getRequirement(requirementId)
  if (!requirement) {
    return Response.json({ error: '需求不存在' }, { status: 404 })
  }

  // 运行完整工作流
  const result = await runPresalesWorkflow(
    projectId,
    requirementId,
    requirement.raw_content
  )

  if (result.error) {
    return Response.json({ error: result.error }, { status: 500 })
  }

  // 保存结果到数据库
  const supabase = await createClient()

  // 保存需求分析结果
  if (result.analysis) {
    await updateRequirementAnalysis(requirementId, result.analysis)
  }

  // 保存功能模块
  if (result.functions?.length) {
    await supabase.from('function_modules').insert(
      result.functions.map(fn => ({
        project_id: projectId,
        ...fn,
      }))
    )
  }

  // 保存成本估算
  if (result.cost) {
    await supabase.from('cost_estimates').insert({
      project_id: projectId,
      ...result.cost,
    })
  }

  return Response.json(result)
}
```

**验收标准**:
- [x] LangGraph 工作流正常执行
- [x] 流式输出正常
- [x] 结果正确保存到数据库

**文件**:
```
app/
  api/
    agent/
      workflow/
        route.ts
      run/
        route.ts
```

---

#### 2.4.2 进度展示组件 ✅

**任务**:
1. 创建进度展示组件 `components/agent/agent-progress.tsx`
2. 显示当前执行阶段
3. 显示各阶段结果预览

**代码示例**:
```typescript
// components/agent/agent-progress.tsx
'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Circle, Loader2 } from 'lucide-react'

interface AgentProgressProps {
  projectId: string
  requirementId: string
  onComplete?: (result: any) => void
}

const steps = [
  { key: 'analyze', label: '需求分析', description: '提取项目类型、业务目标、核心功能' },
  { key: 'breakdown', label: '功能拆解', description: '拆分功能模块、查询功能库' },
  { key: 'estimate', label: '工时评估', description: '计算开发工时、人员配置' },
  { key: 'calculate', label: '成本计算', description: '计算人力成本、生成报价' },
]

export function AgentProgress({ projectId, requirementId, onComplete }: AgentProgressProps) {
  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [completedSteps, setCompletedSteps] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const progress = (completedSteps.length / steps.length) * 100

  const runWorkflow = async () => {
    setIsRunning(true)
    setError(null)
    setCompletedSteps([])

    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, requirementId }),
      })

      const result = await response.json()

      if (result.error) {
        setError(result.error)
      } else {
        setCompletedSteps(['analyze', 'breakdown', 'estimate', 'calculate'])
        onComplete?.(result)
      }
    } catch (err) {
      setError('工作流执行失败')
    } finally {
      setIsRunning(false)
      setCurrentStep(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>AI 分析进度</span>
          {isRunning && <Loader2 className="h-5 w-5 animate-spin" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={progress} />

        <div className="space-y-3">
          {steps.map((step, index) => {
            const isCompleted = completedSteps.includes(step.key)
            const isCurrent = currentStep === step.key
            const isPending = !isCompleted && !isCurrent

            return (
              <div key={step.key} className="flex items-center gap-3">
                {isCompleted ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : isCurrent ? (
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                ) : (
                  <Circle className="h-5 w-5 text-gray-300" />
                )}
                <div className="flex-1">
                  <p className={`font-medium ${isPending ? 'text-gray-400' : ''}`}>
                    {step.label}
                  </p>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
                {isCompleted && <Badge variant="secondary">完成</Badge>}
              </div>
            )
          })}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <button
          onClick={runWorkflow}
          disabled={isRunning}
          className="w-full rounded-md bg-primary px-4 py-2 text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {isRunning ? '分析中...' : '开始分析'}
        </button>
      </CardContent>
    </Card>
  )
}
```

**验收标准**:
- [x] 进度条正确显示
- [x] 各阶段状态正确
- [x] 错误提示正常

**文件**:
```
components/
  agent/
    agent-progress.tsx
```

---

### 2.5 功能明细展示 ✅

**优先级**: 🟡 中

**任务**:
1. 创建功能明细页 `app/projects/[id]/functions/page.tsx`
2. 创建功能表格组件 `components/project/function-table.tsx`
3. 显示所有功能模块
4. 支持编辑工时
5. 支持添加/删除功能
6. 计算总工时

**验收标准**:
- [x] 功能列表展示完整
- [x] 可编辑工时
- [x] 总计正确

**文件**:
```
app/
  projects/
    [id]/
      functions/
        page.tsx
components/
  project/
    function-table.tsx
```

---

### 2.6 成本估算展示 ✅

**优先级**: 🟡 中

**任务**:
1. 创建成本估算页 `app/projects/[id]/estimation/page.tsx`
2. 创建成本摘要组件 `components/project/cost-summary.tsx`
3. 显示：
   - 人力成本
   - 服务成本
   - 基础设施成本
   - 风险缓冲
   - 总成本
4. 显示成本明细饼图（可选）

**验收标准**:
- [x] 成本展示清晰
- [x] 明细完整

**文件**:
```
app/
  projects/
    [id]/
      estimation/
        page.tsx
components/
  project/
    cost-summary.tsx
```

---

## ✅ 阶段 3: 高级功能开发

### 3.1 对话式需求澄清

**优先级**: 🟡 中

**任务**:
1. 创建对话组件 `components/agent/agent-chat.tsx`
2. 使用 AI SDK UI 的 `useChat` hook
3. Agent 主动提问场景：
   - 需求不完整
   - 技术方案不明确
   - 预算范围未知
4. 创建 API Route `app/api/chat/route.ts`

**代码示例**:
```typescript
// components/agent/agent-chat.tsx
'use client'

import { useChat } from '@ai-sdk/react'

export function AgentChat({ projectId }: { projectId: string }) {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: '/api/chat',
    body: { projectId },
  })

  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>
          <strong>{m.role}:</strong> {m.content}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button type="submit">发送</button>
      </form>
    </div>
  )
}
```

**验收标准**:
- [x] 可以与 Agent 对话
- [x] Agent 提问合理
- [x] 对话历史保存

**文件**:
```
components/
  agent/
    agent-chat.tsx
app/
  api/
    chat/
      route.ts
```

---

### 3.2 模板管理

**优先级**: 🟢 低

#### 3.2.1 模板列表页

**任务**:
1. 创建模板列表页 `app/templates/page.tsx`
2. 按类型分类显示模板
3. 显示模板版本和状态

**验收标准**:
- [x] 显示所有模板
- [x] 分类清晰

**文件**:
```
app/
  templates/
    page.tsx
```

---

#### 3.2.2 模板编辑页

**任务**:
1. 创建模板编辑页 `app/templates/[id]/page.tsx`
2. 富文本编辑器编辑提示词
3. 支持变量占位符（如 `{需求内容}`）
4. 保存新版本

**验收标准**:
- [x] 可以编辑模板
- [x] 版本管理正常

**文件**:
```
app/
  templates/
    [id]/
      page.tsx
```

---

### 3.3 功能库管理

**优先级**: 🟢 低

#### 3.3.1 功能库列表页

**任务**:
1. 创建功能库页 `app/function-library/page.tsx`
2. 按分类显示功能
3. 搜索功能
4. 添加新功能按钮

**验收标准**:
- [x] 显示所有功能
- [x] 搜索正常

**文件**:
```
app/
  function-library/
    page.tsx
```

---

#### 3.3.2 功能编辑

**任务**:
1. 创建功能编辑对话框
2. 编辑标准工时
3. 编辑复杂度系数

**验收标准**:
- [x] 可以编辑功能
- [x] 保存成功

---

### 3.4 报告导出

**优先级**: 🟡 中

#### 3.4.1 PDF 导出

**任务**:
1. 创建 PDF 生成工具 `lib/utils/export.ts`
2. 使用 jsPDF 生成 PDF
3. 包含：
   - 项目概述
   - 需求分析
   - 功能清单（表格）
   - 成本估算
4. 添加导出按钮到报告页

**代码示例**:
```typescript
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export function generatePDFReport(project: any) {
  const doc = new jsPDF()

  doc.text('售前成本估算报告', 20, 20)
  doc.text(`项目名称: ${project.name}`, 20, 30)

  autoTable(doc, {
    head: [['功能名称', '难度', '工时']],
    body: project.functions.map(f => [f.name, f.difficulty, f.hours]),
  })

  doc.save('report.pdf')
}
```

**验收标准**:
- [x] PDF 生成成功
- [x] 格式美观
- [x] 包含所有必要信息

**文件**:
```
lib/
  utils/
    export.ts
app/
  projects/
    [id]/
      report/
        page.tsx
```

---

#### 3.4.2 Excel 导出

**任务**:
1. 使用 xlsx 生成 Excel
2. 两个 Sheet：
   - 功能清单
   - 成本明细
3. 添加导出按钮

**验收标准**:
- [x] Excel 导出成功
- [x] 数据完整

---

### 3.5 系统设置

**优先级**: 🟢 低

**任务**:
1. 创建设置页 `app/settings/page.tsx`
2. 配置项：
   - 默认人天成本
   - 风险缓冲比例
   - AI 模型选择（Claude Sonnet / Opus）
3. 保存到 `system_config` 表

**验收标准**:
- [x] 可以修改配置
- [x] 配置生效

**文件**:
```
app/
  settings/
    page.tsx
```

---

## ⏳ 阶段 4: 测试和优化

### 4.1 单元测试

**任务**:
- [ ] 测试 Agent 函数
- [ ] 测试工具函数
- [ ] 测试数据库操作

**工具**: Vitest 或 Jest

---

### 4.2 集成测试

**任务**:
- [ ] 测试完整工作流
- [ ] 测试 API 端点
- [ ] 测试错误处理

---

### 4.3 性能优化

**任务**:
- [ ] 优化 Agent 调用（缓存模板）
- [ ] 优化数据库查询（索引）
- [ ] 图片懒加载
- [ ] 代码分割

---

### 4.4 用户测试

**任务**:
- [ ] 邀请内部用户测试
- [ ] 收集反馈
- [ ] 修复 Bug
- [ ] 优化 UX

---

## 📦 开发提示

### 开发顺序建议

1. **先搭基础**：认证 → 布局 → 项目 CRUD
2. **再做核心**：需求输入 → Agent 工作流 → 结果展示
3. **最后完善**：对话式交互 → 模板管理 → 导出功能

### 技术要点

#### AI SDK + LangGraph 集成架构

本项目使用 **AI SDK 6.0 + LangGraph** 构建真正的 Agent 工作流系统：
- **AI SDK 6.0**: 提供 AI 模型调用、结构化输出、Tool Calling 能力
- **LangGraph**: 提供状态图、条件分支、工作流编排能力
- **@ai-sdk/langchain**: 提供两者之间的适配器

> 参考文档:
> - AI SDK: https://ai-sdk.dev/docs/getting-started/nextjs-app-router
> - LangGraph: https://langchain-ai.github.io/langgraphjs/

**核心依赖包**:
```bash
pnpm add ai @ai-sdk/langchain @langchain/langgraph @langchain/core
```

| 包名 | 版本 | 用途 |
|------|------|------|
| `ai` | 6.x | AI SDK 核心功能 |
| `@ai-sdk/langchain` | Latest | AI SDK ↔ LangChain 适配器 |
| `@langchain/langgraph` | Latest | 状态图和工作流编排 |
| `@langchain/core` | Latest | LangChain 核心类型 |

> ⚠️ **AI SDK 6.0 重要变更**:
> - `generateObject()` 已弃用 → 使用 `generateText()` + `Output.object()`
> - `streamObject()` 已弃用 → 使用 `streamText()` + `Output.object()`
> - Tool 定义需要使用 `tool()` 函数包装
> - 多步骤执行使用 `stepCountIs()` 控制
> - 流式响应使用 `toUIMessageStreamResponse()`

---

#### LangGraph 状态图使用

**StateGraph 基本结构**:
```typescript
import { StateGraph, Annotation, START, END } from '@langchain/langgraph'

// 1. 定义状态
const StateAnnotation = Annotation.Root({
  input: Annotation<string>,
  output: Annotation<string | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),
})

// 2. 定义节点函数
async function processNode(state: typeof StateAnnotation.State) {
  return { output: `处理结果: ${state.input}` }
}

// 3. 构建图
const graph = new StateGraph(StateAnnotation)
  .addNode('process', processNode)
  .addEdge(START, 'process')
  .addEdge('process', END)
  .compile()

// 4. 执行图
const result = await graph.invoke({ input: '测试' })
```

**条件路由**:
```typescript
function routeDecision(state: State) {
  if (state.error) return 'error_handler'
  if (state.needsReview) return 'human_review'
  return 'next_step'
}

graph.addConditionalEdges('check', routeDecision, {
  error_handler: 'handleError',
  human_review: 'waitForHuman',
  next_step: 'continue',
})
```

**流式执行**:
```typescript
// 流式执行工作流
const stream = await graph.stream(
  initialState,
  { streamMode: ['values', 'messages'] }
)

// 转换为 AI SDK 流式响应
import { toUIMessageStream } from '@ai-sdk/langchain'
import { createUIMessageStreamResponse } from 'ai'

return createUIMessageStreamResponse({
  stream: toUIMessageStream(stream),
})
```

---

#### AI SDK 使用（Vercel AI SDK 6.0 + Gateway）

**Gateway 使用方式**:
```typescript
// 使用 createGateway 创建 gateway 实例
import { createGateway } from 'ai'

const gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY,
})

// 使用示例
const model = gateway('anthropic/claude-sonnet-4')
```

**环境变量配置** (`.env.local`):
```bash
# AI Gateway 配置
AI_GATEWAY_API_KEY=your_api_key                      # Gateway API 密钥
AI_GATEWAY_MODEL=anthropic/claude-sonnet-4           # 默认模型
AI_GATEWAY_MODEL_FAST=anthropic/claude-haiku         # 快速模型
AI_GATEWAY_MODEL_POWERFUL=anthropic/claude-opus-4    # 强力模型
```

**主要 API**:
- `createGateway()` - 创建 AI Gateway 实例
- `generateText()` - 生成文本，支持 Tool Calling 和结构化输出
- `streamText()` - 流式文本生成，实时展示 Agent 输出
- `Output.object()` - 定义结构化输出 Schema
- `tool()` - 定义工具函数
- `stepCountIs()` - 控制多步骤执行次数
- `convertToModelMessages()` - 转换消息格式
- `useChat()` - React Hook，实现对话式交互

**配置示例** (`lib/ai/config.ts`):
```typescript
import { createGateway } from 'ai'

// 创建 Gateway 实例
const gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY,
})

// 从环境变量读取模型配置
const DEFAULT_MODEL = process.env.AI_GATEWAY_MODEL || 'anthropic/claude-sonnet-4'
const FAST_MODEL = process.env.AI_GATEWAY_MODEL_FAST || 'anthropic/claude-haiku'
const POWERFUL_MODEL = process.env.AI_GATEWAY_MODEL_POWERFUL || 'anthropic/claude-opus-4'

export const defaultModel = gateway(DEFAULT_MODEL)
export const fastModel = gateway(FAST_MODEL)
export const powerfulModel = gateway(POWERFUL_MODEL)
```

**结构化输出示例**:
```typescript
import { generateText, Output } from 'ai'
import { z } from 'zod'

const { output } = await generateText({
  model: defaultModel,
  output: Output.object({
    schema: z.object({
      name: z.string(),
      items: z.array(z.string()),
    }),
  }),
  prompt: '...',
})
```

**Tool Calling 示例**:
```typescript
import { generateText, tool, stepCountIs } from 'ai'
import { z } from 'zod'

const { output } = await generateText({
  model: defaultModel,
  tools: {
    searchDatabase: tool({
      description: '搜索数据库',
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async ({ query }) => {
        // 执行数据库查询
        return results
      },
    }),
  },
  stopWhen: stepCountIs(5), // 最多执行 5 步
  prompt: '...',
})
```

#### Supabase 最佳实践
- Server Components 使用 `createClient()` from `lib/supabase/server.ts`
- Client Components 使用 `createClient()` from `lib/supabase/client.ts`
- 启用 RLS 保护数据安全
- 使用 `supabase.rpc()` 调用存储过程

#### 性能优化
- 使用 Next.js 缓存机制
- Agent 结果缓存到数据库
- 懒加载大组件
- 使用 Server Actions 减少客户端代码

---

## 🔧 常用命令

```bash
# 开发
pnpm dev

# 构建
pnpm build

# 启动生产服务器
pnpm start

# 类型检查
pnpm type-check

# 添加 Shadcn UI 组件
pnpm dlx shadcn@latest add [component-name]
```

---

## 📚 参考文档

- [Next.js 文档](https://nextjs.org/docs)
- [Vercel AI SDK 文档](https://sdk.vercel.ai/docs)
- [Supabase 文档](https://supabase.com/docs)
- [Shadcn UI 文档](https://ui.shadcn.com)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)

---

**文档维护**: 随着开发进度更新任务清单状态
**最后更新**: 2026-01-07

---

## 📝 审查记录

### 2026-01-07 AI SDK 6.0 兼容性审查

**发现的问题**:
1. ~~`generateObject()` 在文档示例中使用~~ → 已更新为 `generateText()` + `Output.object()`
2. ~~Tool 定义方式过时~~ → 已更新为 `tool()` 函数包装
3. ~~缺少 `stepCountIs()` 多步骤控制~~ → 已添加
4. ~~流式响应方法过时~~ → 已更新为 `toUIMessageStreamResponse()`

**已完成的更新**:
- [x] 2.3.1 需求分析 Agent 代码示例
- [x] 2.3.2 功能拆解 Agent 代码示例
- [x] 2.4.1 流式 Agent 执行代码示例
- [x] 技术要点 - AI SDK 使用说明

**待验证**:
- [ ] 实际运行测试 AI SDK 6.0 API
- [ ] 验证 Gateway 配置是否正确

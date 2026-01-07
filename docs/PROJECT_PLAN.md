# 售前成本估算 Agent 系统 - 项目规划文档

> 版本: 1.0
> 创建日期: 2026-01-06
> 最后更新: 2026-01-06

## 📋 目录

1. [项目概述](#项目概述)
2. [系统架构](#系统架构)
3. [核心功能](#核心功能)
4. [技术栈](#技术栈)
5. [数据模型](#数据模型)
6. [Agent 工作流](#agent-工作流)
7. [开发步骤](#开发步骤)
8. [部署说明](#部署说明)

---

## 项目概述

### 业务目标

构建一个智能化的售前支持系统，通过 AI Agent 自动将客户的项目需求评估内容转化为结构化的售前文档，包括：

- ✅ 成本估算报告
- ✅ 功能明细清单
- ✅ 工作量分析表
- ✅ 人员配置建议

### 核心价值

- **提升效率**：售前人员制作报价文档的时间从 2-3 天缩短到 30 分钟
- **标准化**：统一的功能拆解和成本计算标准
- **准确性**：基于历史数据和功能库的智能估算
- **可追溯**：完整的需求分析和估算过程记录

---

## 系统架构

### 技术架构图

> 📦 **技术选型**: 使用 **AI SDK 6.0 + LangGraph** 构建真正的 Agent 工作流，获得状态图、条件分支、工作流编排等高级能力。

```
┌─────────────────────────────────────────────────────────────┐
│                        前端层 (Next.js)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ 项目管理 │  │ Agent UI │  │ 模板管理 │  │ 功能库   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                         useChat()                            │
└─────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────┐
│                   Next.js API Route                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              LangGraph StateGraph                        ││
│  │                                                          ││
│  │  ┌──────────┐   ┌──────────┐   ┌──────────┐            ││
│  │  │ 需求分析 │ → │ 功能拆解 │ → │ 工时评估 │            ││
│  │  │  Node    │   │   Node   │   │   Node   │            ││
│  │  └──────────┘   └──────────┘   └──────────┘            ││
│  │       ↓              ↓              ↓                   ││
│  │  ┌──────────────────────────────────────────┐          ││
│  │  │           Tools (查询功能库)              │          ││
│  │  └──────────────────────────────────────────┘          ││
│  │                      ↓                                  ││
│  │               ┌──────────┐                              ││
│  │               │ 成本计算 │                              ││
│  │               │   Node   │                              ││
│  │               └──────────┘                              ││
│  └─────────────────────────────────────────────────────────┘│
│                         ↓                                    │
│              toUIMessageStream()                             │
└─────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────┐
│         AI SDK 6.0 + @ai-sdk/langchain 适配器               │
│  generateText() | Output.object() | tool() | stepCountIs() │
└─────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────┐
│                AI 模型层 (AI Gateway)                        │
│              via Vercel AI SDK gateway()                     │
│        支持: anthropic/claude-sonnet-4, openai/gpt-4 等      │
└─────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────┐
│                   数据层 (Supabase PostgreSQL)               │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐           │
│  │ 项目表 │  │ 需求表 │  │ 功能表 │  │ 模板表 │           │
│  └────────┘  └────────┘  └────────┘  └────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构

```
presales-agent/
├── app/                      # Next.js App Router
│   ├── dashboard/            # 仪表盘页面
│   ├── projects/             # 项目管理页面
│   │   ├── page.tsx          # 项目列表
│   │   ├── new/              # 新建项目
│   │   └── [id]/             # 项目详情
│   │       ├── requirements/ # 需求输入
│   │       ├── functions/    # 功能明细
│   │       ├── estimation/   # 成本估算
│   │       └── report/       # 报告预览
│   ├── templates/            # 模板管理页面
│   ├── function-library/     # 功能库页面
│   ├── settings/             # 系统设置页面
│   ├── api/                  # API Routes
│   └── actions/              # Server Actions
│
├── components/               # React 组件
│   ├── ui/                   # Shadcn UI 组件
│   ├── agent/                # Agent 相关组件
│   │   ├── agent-chat.tsx    # 对话式交互组件
│   │   ├── agent-progress.tsx # Agent 执行进度
│   │   └── stream-viewer.tsx # 流式输出查看器
│   ├── project/              # 项目相关组件
│   │   ├── requirement-input.tsx
│   │   ├── function-table.tsx
│   │   └── cost-summary.tsx
│   └── layout/               # 布局组件
│       ├── sidebar.tsx
│       └── header.tsx
│
├── lib/                      # 核心库
│   ├── supabase/             # Supabase 客户端
│   │   ├── client.ts         # 浏览器端客户端
│   │   └── server.ts         # 服务端客户端
│   ├── ai/                   # AI SDK 配置
│   │   └── config.ts         # 模型配置
│   ├── agents/               # Agent 实现
│   │   ├── requirement-analysis.ts
│   │   ├── function-breakdown.ts
│   │   ├── effort-estimation.ts
│   │   ├── cost-calculation.ts
│   │   └── workflow.ts       # Agent 工作流编排
│   └── utils/                # 工具函数
│       ├── document-parser.ts # 文档解析
│       └── export.ts         # 导出功能
│
├── hooks/                    # 自定义 Hooks
│   ├── use-project.ts
│   ├── use-agent-workflow.ts
│   └── use-stream-text.ts
│
├── types/                    # TypeScript 类型
│   └── index.ts
│
├── constants/                # 常量配置
│   └── index.ts
│
└── docs/                     # 项目文档
    ├── PROJECT_PLAN.md       # 项目规划（本文档）
    ├── DEVELOPMENT_GUIDE.md  # 开发步骤指南
    ├── database-schema.sql   # 数据库 Schema
    └── function-library-seed.sql # 功能库种子数据
```

---

## 核心功能

### 1. 项目管理

**功能描述**：管理售前项目的生命周期

**子功能**：
- 创建新项目（填写项目名称、行业、描述）
- 项目列表（查看、搜索、筛选）
- 项目详情（查看完整信息和分析结果）
- 项目状态管理（草稿、分析中、已完成、已归档）

### 2. 需求输入模块

**功能描述**：支持多种方式输入客户需求

**输入方式**：
- ✅ 文本直接输入（富文本编辑器）
- ✅ 文档上传（Word、PDF 自动解析）
- ✅ 历史项目模板选择
- ✅ 对话式需求补充（AI 主动提问）

### 3. AI Agent 处理引擎

**功能描述**：多 Agent 协作自动分析需求

#### Agent 1: 需求分析
- **输入**：原始需求文本
- **输出**：结构化需求分析（JSON）
- **功能**：
  - 识别项目类型
  - 提取核心业务目标
  - 识别技术栈需求
  - 标注非功能性需求
  - 识别潜在风险点

#### Agent 2: 功能拆解
- **输入**：需求分析结果
- **输出**：功能模块清单
- **功能**：
  - 拆解为一级、二级功能模块
  - 标注每个功能的难度等级
  - 自动查询功能库匹配标准模块
  - 识别功能依赖关系

#### Agent 3: 工时评估
- **输入**：功能模块清单
- **输出**：工时估算结果
- **功能**：
  - 基于功能库计算标准工时
  - 根据难度系数调整
  - 生成人员配置建议
  - 计算关键路径

#### Agent 4: 成本计算
- **输入**：工时评估结果
- **输出**：完整成本报告
- **功能**：
  - 人力成本计算
  - 第三方服务成本估算
  - 基础设施成本
  - 风险缓冲（可配置）
  - 生成总报价

### 4. 实时流式交互

**功能描述**：展示 Agent 思考和分析过程

**特性**：
- 使用 AI SDK 的 `streamText` 实时展示 Agent 输出
- 进度条显示当前执行阶段
- 可中断和恢复
- 支持查看历史执行记录

### 5. 对话式需求澄清

**功能描述**：Agent 主动提问补充需求

**场景**：
- 需求信息不完整时自动提问
- 存在多种技术方案时询问偏好
- 预算范围不明确时引导确认

**实现**：使用 AI SDK UI 的 `useChat` hook

### 6. 模板管理

**功能描述**：管理 Agent 使用的提示词模板

**功能**：
- 查看所有模板（按类型分类）
- 编辑模板内容
- 模板版本管理
- 行业特定模板
- 启用/禁用模板

### 7. 功能库管理

**功能描述**：维护常见功能及其标准工时

**功能**：
- 功能列表（按分类查看）
- 添加新功能
- 编辑标准工时
- 设置复杂度系数
- 功能搜索

### 8. 报告导出

**功能描述**：导出专业的售前报告

**导出格式**：
- ✅ PDF（完整报告，含图表）
- ✅ Excel（成本明细表、功能清单）
- ❌ Word（不实现）

**报告内容**：
- 项目概述
- 需求分析摘要
- 功能模块清单
- 工作量分析
- 成本估算（含分项）
- 人员配置建议
- 项目计划建议

### 9. 系统设置

**功能描述**：配置系统参数

**配置项**：
- 默认人天成本
- 默认风险缓冲比例
- 货币单位
- AI 模型选择

---

## 技术栈

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 15 | 全栈框架 |
| React | 19 | UI 库 |
| TypeScript | 5.x | 类型系统 |
| Tailwind CSS | 4 | 样式框架 |
| Shadcn UI | Latest | UI 组件库 |
| React Hook Form | 7.x | 表单管理 |
| Zod | 4.x | 数据验证 |
| Zustand | 5.x | 状态管理（可选） |
| Lucide React | Latest | 图标库 |

### AI 能力

| 技术 | 版本 | 用途 |
|------|------|------|
| Vercel AI SDK | 6.x | AI 集成核心 |
| @ai-sdk/langchain | Latest | AI SDK ↔ LangChain 适配器 |
| @langchain/langgraph | Latest | 状态图和工作流编排 |
| @langchain/core | Latest | LangChain 核心类型 |
| @langchain/openai | Latest | OpenAI 模型支持 |
| AI Gateway | - | 统一模型访问入口 |
| Claude Sonnet 4 | Latest | 默认 AI 模型（可配置）|

> **AI SDK + LangGraph 集成架构**:
> - **AI SDK 6.0**: 提供 AI 模型调用、结构化输出、Tool Calling 能力
> - **LangGraph**: 提供状态图、条件分支、工作流编排能力
> - **@ai-sdk/langchain**: 提供两者之间的适配器
>
> 通过 AI Gateway (`gateway()`) 访问模型，支持通过环境变量 `AI_GATEWAY_MODEL` 配置不同模型

### 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js Server Actions | - | 主要后端逻辑 |
| Next.js API Routes | - | 流式响应 |

### 数据库

| 技术 | 版本 | 用途 |
|------|------|------|
| Supabase | Latest | BaaS 平台 |
| PostgreSQL | 15+ | 关系数据库 |
| Supabase Auth | - | 用户认证 |
| Supabase Storage | - | 文件存储 |

### 文档处理

| 技术 | 版本 | 用途 |
|------|------|------|
| mammoth | 1.x | Word 解析 |
| pdf-parse | 2.x | PDF 解析 |
| jsPDF | 4.x | PDF 生成 |
| jspdf-autotable | 5.x | PDF 表格 |
| xlsx | 0.18.x | Excel 处理 |

### 部署

| 技术 | 用途 |
|------|------|
| Vercel | 托管平台 |
| pnpm | 包管理器 |

---

## 数据模型

详细的数据库 Schema 请参考：`docs/database-schema.sql`

### 核心表关系

```
profiles (用户)
    ↓ created_by
projects (项目)
    ↓ project_id
    ├── requirements (需求)
    ├── function_modules (功能模块)
    ├── cost_estimates (成本估算)
    └── agent_executions (Agent 执行记录)

templates (模板) - 独立表
function_library (功能库) - 独立表
system_config (系统配置) - 独立表
```

### 主要字段说明

#### projects 表
- `status`: draft | analyzing | completed | archived
- `industry`: 行业类型（自由文本）

#### function_modules 表
- `difficulty_level`: simple | medium | complex | very_complex
- `estimated_hours`: 估算工时（小时）
- `dependencies`: 依赖的其他功能 ID 数组

#### cost_estimates 表
- `breakdown`: JSONB 格式的成本明细

#### templates 表
- `template_type`: requirement_analysis | function_breakdown | effort_estimation | cost_calculation
- `is_active`: 是否启用

---

## Agent 工作流

> 📦 **LangGraph 状态图**: 使用 LangGraph 的 StateGraph 实现工作流编排，支持条件分支、错误处理和状态持久化。

### LangGraph 工作流图

```
        ┌─────────┐
        │  START  │
        └────┬────┘
             ↓
        ┌─────────┐
        │ analyze │ ──────────────────┐
        │  Node   │                   │
        └────┬────┘                   │
             ↓ (成功)                  ↓ (错误)
        ┌──────────┐              ┌─────┐
        │breakdown │ ────────────→│ END │
        │   Node   │              └─────┘
        └────┬─────┘                  ↑
             ↓ (成功)                  │
        ┌──────────┐                  │
        │ estimate │ ─────────────────┤
        │   Node   │                  │
        └────┬─────┘                  │
             ↓ (成功)                  │
        ┌───────────┐                 │
        │ calculate │ ────────────────┘
        │   Node    │
        └─────┬─────┘
              ↓ (完成)
        ┌─────────┐
        │   END   │
        └─────────┘
```

### 完整流程图

```
用户输入需求
    ↓
[预处理] 文档解析 / 格式化
    ↓
┌─────────────────────────────────────────┐
│ Node 1: 需求分析 (analyze)               │
│ - 使用 generateText + Output.object()   │
│ - 输出结构化需求分析                     │
│ - 更新状态: currentStep → 'breakdown'   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Node 2: 功能拆解 (breakdown)             │
│ - 使用 generateText + tool() + stepCountIs() │
│ - Tool: searchFunctionLibrary           │
│ - 输出功能模块清单                       │
│ - 更新状态: currentStep → 'estimate'    │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Node 3: 工时评估 (estimate)              │
│ - 基于功能库标准工时                     │
│ - 难度系数调整                           │
│ - 输出工时明细和人员配置                 │
│ - 更新状态: currentStep → 'calculate'   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Node 4: 成本计算 (calculate)             │
│ - 计算人力成本                           │
│ - 估算第三方服务成本                     │
│ - 应用风险缓冲                           │
│ - 更新状态: currentStep → 'complete'    │
└─────────────────────────────────────────┘
    ↓
保存到数据库 + 生成报告
    ↓
展示结果 / 导出文档
```

### Agent 实现示例

详见：`lib/agents/` 目录

**目录结构**:
```
lib/
  agents/
    state.ts           # LangGraph 状态定义 (Annotation)
    graph.ts           # StateGraph 工作流编排
    nodes/
      analyze.ts       # 需求分析节点
      breakdown.ts     # 功能拆解节点
      estimate.ts      # 工时评估节点
      calculate.ts     # 成本计算节点
      index.ts         # 导出所有节点
```

**核心 API (AI SDK 6.0)**：
- `generateText()` + `Output.object()` - 结构化输出（替代已弃用的 generateObject）
- `streamText()` + `Output.object()` - 流式结构化输出（替代已弃用的 streamObject）
- `tool()` - 定义工具函数
- `stepCountIs()` - 控制多步骤执行次数

**核心 API (LangGraph)**：
- `StateGraph` - 创建状态图
- `Annotation` - 定义工作流状态
- `addNode()` - 添加处理节点
- `addEdge()` / `addConditionalEdges()` - 定义节点连接和条件路由
- `compile()` - 编译工作流
- `stream()` - 流式执行工作流

**适配器 (@ai-sdk/langchain)**：
- `toBaseMessages()` - 将 AI SDK 消息转换为 LangChain 格式
- `toUIMessageStream()` - 将 LangGraph 流转换为 AI SDK 流式响应

---

## 开发步骤

详细的开发步骤请参考：`docs/DEVELOPMENT_GUIDE.md`

### 阶段概览

#### 阶段 1: 基础设施（第 1-2 周）
- ✅ 项目初始化
- ✅ Supabase 配置
- ✅ 数据库 Schema 创建
- ⏳ 基础 UI 组件

#### 阶段 2: 核心功能（第 3-5 周）
- ⏳ 项目管理 CRUD
- ⏳ 需求输入模块
- ⏳ Agent 工作流实现
- ⏳ 实时流式展示

#### 阶段 3: 高级功能（第 6-7 周）
- ⏳ 对话式交互
- ⏳ 模板管理
- ⏳ 功能库管理
- ⏳ 报告导出

#### 阶段 4: 优化和测试（第 8 周）
- ⏳ 性能优化
- ⏳ 单元测试
- ⏳ 集成测试
- ⏳ 用户测试

---

## 部署说明

### 环境变量配置

复制 `.env.local.example` 到 `.env.local`，填写以下变量：

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# AI Gateway 模型配置
AI_GATEWAY_MODEL=anthropic/claude-sonnet-4           # 默认模型
AI_GATEWAY_MODEL_FAST=anthropic/claude-haiku         # 快速模型（可选）
AI_GATEWAY_MODEL_POWERFUL=anthropic/claude-opus-4    # 强力模型（可选）

# Application
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

### Vercel 部署步骤

1. 连接 GitHub 仓库
2. 配置环境变量
3. 部署命令：
   ```bash
   pnpm build
   ```
4. 自动部署完成

### Supabase 初始化

1. 创建 Supabase 项目
2. 执行 `docs/database-schema.sql`
3. 执行 `docs/function-library-seed.sql`（可选）
4. 配置 Storage bucket（用于文件上传）

---

## 后续优化方向

### 功能增强
- [ ] 多人协作（多人同时编辑项目）
- [ ] 历史版本对比
- [ ] 自动推荐相似项目
- [ ] 项目复制和模板保存
- [ ] 甘特图可视化

### 技术优化
- [ ] 增加 Redis 缓存
- [ ] Agent 执行队列化
- [ ] 支持更多文档格式
- [ ] 多语言支持
- [ ] 移动端适配

### AI 增强
- [ ] 支持多模型切换（GPT-4、Claude Opus）
- [ ] 微调专用模型
- [ ] RAG 增强（向量数据库）
- [ ] Agent 自我学习（从历史数据学习）

---

## 相关文档

- [开发步骤指南](./DEVELOPMENT_GUIDE.md) - 详细的开发任务拆解
- [数据库 Schema](./database-schema.sql) - 完整的数据库定义
- [功能库种子数据](./function-library-seed.sql) - 初始功能库数据

---

**文档维护者**: 项目团队
**联系方式**: 项目管理员
**最后更新**: 2026-01-07

---

## 📝 更新记录

### 2026-01-07 架构升级: AI SDK + LangGraph

**主要变更**:
1. 技术架构图更新为 LangGraph StateGraph 模式
2. 添加 LangGraph 相关依赖说明
3. Agent 工作流部分添加 LangGraph 状态图和节点说明
4. 更新核心 API 说明（AI SDK 6.0 + LangGraph）

**新增依赖**:
```bash
pnpm add @ai-sdk/langchain @langchain/langgraph @langchain/core @langchain/openai
```

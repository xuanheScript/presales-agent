# 售前成本估算 Agent 系统

> 基于 AI Agent 的智能售前支持系统，自动将项目需求转化为成本估算报告

[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![AI SDK](https://img.shields.io/badge/AI%20SDK-6.x-green)](https://sdk.vercel.ai/)
[![Supabase](https://img.shields.io/badge/Supabase-Latest-3ecf8e)](https://supabase.com/)

## 📖 项目简介

这是一个智能化的售前支持系统，通过多个 AI Agent 协作，自动将客户的项目需求评估内容转化为专业的售前文档，包括：

- ✅ **成本估算报告** - 精准的人力和资源成本计算
- ✅ **功能明细清单** - 结构化的功能模块拆解
- ✅ **工作量分析** - 基于历史数据的工时评估
- ✅ **人员配置建议** - 合理的团队组建方案

### 核心价值

- 🚀 **提升效率**：售前文档制作时间从 2-3 天缩短到 30 分钟
- 📊 **标准化**：统一的功能拆解和成本计算标准
- 🎯 **准确性**：基于功能库和历史数据的智能估算
- 📝 **可追溯**：完整的需求分析和估算过程记录

## 🏗️ 技术栈

| 分类 | 技术 |
|------|------|
| **框架** | Next.js 15 (App Router) |
| **语言** | TypeScript 5.x |
| **AI 能力** | Vercel AI SDK + AI Gateway (支持 Claude/GPT 等) |
| **数据库** | Supabase (PostgreSQL) |
| **样式** | Tailwind CSS 4 |
| **UI 组件** | Shadcn UI |
| **表单** | React Hook Form + Zod |
| **包管理** | pnpm |

## 🚀 快速开始

### 环境要求

- Node.js 18.x 或更高版本
- pnpm 10.x 或更高版本

### 安装步骤

1. **克隆项目**

```bash
git clone <repository-url>
cd presales-agent
```

2. **安装依赖**

```bash
pnpm install
```

3. **配置环境变量**

复制 `.env.local.example` 到 `.env.local`：

```bash
cp .env.local.example .env.local
```

编辑 `.env.local` 并填写以下变量：

```bash
# Supabase 配置（从 Supabase 项目设置中获取）
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# AI Gateway 模型配置（通过环境变量自定义）
AI_GATEWAY_MODEL=anthropic/claude-sonnet-4           # 默认模型
AI_GATEWAY_MODEL_FAST=anthropic/claude-haiku         # 快速模型（可选）
AI_GATEWAY_MODEL_POWERFUL=anthropic/claude-opus-4    # 强力模型（可选）

# 应用 URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# 成本配置（可选）
DEFAULT_LABOR_COST_PER_DAY=1500
DEFAULT_RISK_BUFFER_PERCENTAGE=15
```

4. **设置 Supabase 数据库**

在 Supabase 控制台的 SQL Editor 中执行：

```sql
-- 1. 创建所有表和索引
-- 执行文件：docs/database-schema.sql

-- 2. 初始化功能库数据（可选）
-- 执行文件：docs/function-library-seed.sql
```

5. **启动开发服务器**

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看应用。

## 📁 项目结构

```
presales-agent/
├── app/                      # Next.js App Router
│   ├── dashboard/            # 仪表盘
│   ├── projects/             # 项目管理
│   ├── templates/            # 模板管理
│   ├── function-library/     # 功能库
│   ├── settings/             # 系统设置
│   ├── api/                  # API Routes
│   └── actions/              # Server Actions
├── components/               # React 组件
│   ├── ui/                   # Shadcn UI 组件
│   ├── agent/                # Agent 相关组件
│   ├── project/              # 项目相关组件
│   └── layout/               # 布局组件
├── lib/                      # 核心库
│   ├── supabase/             # Supabase 客户端
│   ├── ai/                   # AI SDK 配置
│   ├── agents/               # Agent 实现
│   └── utils/                # 工具函数
├── hooks/                    # 自定义 Hooks
├── types/                    # TypeScript 类型
├── constants/                # 常量配置
└── docs/                     # 项目文档
    ├── PROJECT_PLAN.md       # 详细项目规划
    ├── DEVELOPMENT_GUIDE.md  # 开发步骤指南
    ├── database-schema.sql   # 数据库 Schema
    └── function-library-seed.sql
```

## 🤖 Agent 工作流

系统使用 4 个 AI Agent 协作处理需求：

```
用户输入需求
    ↓
[Agent 1] 需求分析
    - 识别项目类型
    - 提取核心功能
    - 识别技术栈
    ↓
[Agent 2] 功能拆解
    - 拆解功能模块
    - 查询功能库
    - 标注难度等级
    ↓
[Agent 3] 工时评估
    - 计算标准工时
    - 应用难度系数
    - 生成人员配置
    ↓
[Agent 4] 成本计算
    - 人力成本
    - 服务成本
    - 风险缓冲
    ↓
生成完整报告
```

## 📚 文档

- **[项目规划文档](./docs/PROJECT_PLAN.md)** - 完整的系统设计和功能规划
- **[开发步骤指南](./docs/DEVELOPMENT_GUIDE.md)** - 详细的开发任务和步骤
- **[数据库 Schema](./docs/database-schema.sql)** - 完整的数据库设计
- **[功能库种子数据](./docs/function-library-seed.sql)** - 初始功能库数据

## 🔧 开发命令

```bash
# 开发模式
pnpm dev

# 构建生产版本
pnpm build

# 启动生产服务器
pnpm start

# 类型检查
pnpm type-check

# 代码格式化
pnpm format

# 添加 Shadcn UI 组件
pnpm dlx shadcn@latest add [component-name]
```

## 🌟 核心特性

### 1. 多种需求输入方式

- 📝 直接文本输入
- 📄 Word/PDF 文档上传并自动解析
- 💬 对话式需求补充（AI 主动提问）

### 2. 实时流式展示

使用 AI SDK 的流式 API，实时展示 Agent 的思考和分析过程。

### 3. 智能功能匹配

Agent 自动查询功能库，匹配相似功能及其标准工时。

### 4. 可配置成本参数

- 人天成本
- 风险缓冲比例
- 货币单位
- AI 模型选择

### 5. 专业报告导出

- PDF 格式（完整报告，含图表）
- Excel 格式（成本明细、功能清单）

## 🔒 数据安全

- 使用 Supabase Row Level Security (RLS) 保护数据
- 用户只能访问自己创建的项目
- 所有 API 请求都需要认证

## 🚀 部署

### Vercel 部署

1. 连接 GitHub 仓库到 Vercel
2. 配置环境变量
3. 自动部署完成

### 环境变量配置

在 Vercel 项目设置中配置所有 `.env.local` 中的变量。

## 🤝 贡献指南

欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证。

## 📧 联系方式

如有问题或建议，请通过以下方式联系：

- 提交 Issue
- 发送邮件到项目维护者

---

**开发状态**: 🚧 开发中

**版本**: 1.0.0

**最后更新**: 2026-01-07

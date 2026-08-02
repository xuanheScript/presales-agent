# Workflow 与 Agent 命名边界及目录迁移方案

> 方案日期：2026-07-28
> 状态：待批准。本文只描述迁移方案，未经用户再次同意不得移动文件。

## 1. 目标与边界

项目当前同时存在两种不同执行模型：

- **Workflow**：售前估算由 LangGraph 固定编排 `analyze → breakdown → estimate → calculate`，控制流由代码决定。
- **Agent**：Internal Chat、Requirements Elicitation、Git Repository Analysis 使用 AI SDK 的 tools 与 step stop condition，由模型在 SDK harness 中决定是否调用工具。

迁移目标是让目录名称反映真实执行语义：

- 固定、可预先描述的业务流程进入 `lib/workflows/`。
- 具有模型驱动工具选择的 tool-loop 进入 `lib/agents/`。
- 通用 AI 执行策略进入 `lib/ai/`。
- Route 只负责认证、输入输出和 transport，不承载 agent orchestration。

本次规划不改变 API URL、数据库字段、Agent Execution 的 `agent_type`、成本公式或业务输出协议。

## 2. 目标目录

```text
lib/
  ai/
    execution-policy.ts        # 通用 Abort、deadline、retry 分类
    config.ts
    embedding.ts

  workflows/
    presales/
      contracts.ts             # 纯 DTO；不得导入 server-only 依赖
      state.ts                 # LangGraph Annotation 与状态转换
      graph.ts                 # 固定工作流编排
      execution/
        service.ts             # preparation、lifecycle、snapshot、RPC
      nodes/
        analyze.ts
        breakdown.ts
        estimate.ts
        calculate.ts
        index.ts
      index.ts                 # 仅服务端工作流入口

  agents/
    presales-chat/
      agent.ts                 # internal chat 的 streamText orchestration
      tools.ts
      contracts.ts
    requirements-elicitation/
      agent.ts                 # elicitation tool-loop orchestration
      tools.ts
      finalize.ts              # 唯一完成职责（或调用数据库 RPC）
      contracts.ts
    git-repository-analysis/
      agent.ts
      tools.ts
      contracts.ts
```

说明：

- `lib/workflows/presales/contracts.ts` 只放可跨边界使用的纯类型；React 客户端不得导入 `graph.ts`、`state.ts` 或 execution service。
- Workflow、Agent 和工具工厂默认添加 `import 'server-only'`，防止 Supabase server client 或模型密钥进入客户端 bundle。
- `execution-policy.ts` 同时服务售前工作流、Chat、Elicitation 和 Embedding，因此不继续归属于 `lib/agents/`。

## 3. 文件映射

| 当前路径 | 目标路径 |
|---|---|
| `lib/agents/state.ts` | `lib/workflows/presales/state.ts`，纯 DTO 拆到 `contracts.ts` |
| `lib/agents/graph.ts` | `lib/workflows/presales/graph.ts` |
| `lib/agents/nodes/*` | `lib/workflows/presales/nodes/*` |
| `lib/agents/execution-service.ts` | `lib/workflows/presales/execution/service.ts` |
| `lib/agents/execution-policy.ts` | `lib/ai/execution-policy.ts` |
| `app/api/chat/route.ts` 的 internal orchestration | `lib/agents/presales-chat/agent.ts` |
| `app/api/chat/route.ts` 的 elicitation orchestration | `lib/agents/requirements-elicitation/agent.ts` |
| `lib/ai/elicitation/tools.ts` | `lib/agents/requirements-elicitation/tools.ts` |
| Git 解析 routes 中的 tool-loop | `lib/agents/git-repository-analysis/agent.ts` |

API 路径暂不重命名：

- `/api/agent/run`
- `/api/agent/stream`
- `/api/chat`
- `/api/parse-git-repo`
- `/api/parse-git-functions`

保持 URL 可以隔离内部目录重构与前端契约变更。

## 4. 兼容策略

原路径保留薄 re-export 至少一个发布周期：

- `lib/agents/graph.ts`
- `lib/agents/state.ts`
- `lib/agents/execution-service.ts`
- `lib/agents/execution-policy.ts`
- `lib/agents/nodes/*`

规则：

1. 兼容文件只允许 re-export，不保留第二份实现。
2. 新代码一律使用新路径。
3. client component 禁止通过兼容 barrel 导入服务端模块。
4. 在移除 shim 前，全仓活代码应无旧路径 import；冻结证据和历史快照除外。

## 5. 分阶段实施

### 阶段 0：建立基线

- 记录当前工作树和变更范围，不覆盖本轮未提交文件。
- 建立旧路径到新路径 manifest。
- 记录现有 API、SSE 事件、Langfuse observation 名称和数据库 RPC 签名。
- 建立 server/client 边界检查，确保 client bundle 不包含 Supabase server 或模型配置。

### 阶段 1：提取共享边界

- 创建纯 `contracts.ts`。
- 将通用 execution policy 移到 `lib/ai/`，原位置保留 re-export。
- 为 server-only 模块添加边界标记。
- 不改变运行行为。

### 阶段 2：迁移售前 Workflow

- 移动 graph、state、nodes 和 execution service。
- 切换 run/stream routes、Embedding 和 estimate reference 的 imports。
- 保留旧路径 shim。
- 确认固定图、输入准备、取消、超时、Trace 和事务保存行为不变。

### 阶段 3：下沉真正的 Tool-loop Agent

- 从 `app/api/chat/route.ts` 抽出 Internal Chat 和 Elicitation orchestration。
- 从 Git routes 抽出 Git agent 及工具。
- Route 只保留认证、请求解析、response transport、flush 和错误映射。
- 每个 agent 明确工具集合与 stop condition。

### 阶段 4：更新活文档和生成入口

更新：

- `README.md`
- `docs/PROJECT_PLAN.md`
- `docs/DEVELOPMENT_GUIDE.md`
- `scripts/generate_softcopyright_doc.py` 的 `SOURCE_FILES`

文档应明确“1 个售前 Workflow + 多个 Tool-loop Agent”，删除“4 个独立 Agent”的误导表述，并修正 Breakdown 已不等同于旧文档中 tool calling 示例的漂移。

### 阶段 5：移除兼容层

- 至少经过一个发布周期。
- 确认活代码无旧 import，随后单独提交移除 shim。
- 不在同一提交中修改 API URL、RPC 或业务 DTO。

## 6. 软著与证据资产保护

以下文件视为冻结快照，不做批量路径替换，也不因代码移动自动重新生成：

- `docs/soft-copyright-source-code.html`
- `docs/presales-agent-soft-copyright-source-code*.txt`
- `docs/presales-agent-soft-copyright-source-code*.docx`
- `docs/evidence/` 下现有 HTML、图片和运行日志

迁移后如确需新交付物：

1. 先保存旧文件 hash。
2. 新建 manifest，记录 commit、生成日期、SOURCE_FILES 以及旧新路径映射。
3. 生成新版本文件，不覆盖旧快照。
4. 重新生成一套 evidence run；历史证据中的绝对路径保持原样。
5. 验证生成脚本引用的所有源文件存在，并单独核对软著要求的行数和页数。

`.claude/settings.local.json` 等本地设置中的绝对路径只在确认用途后单独处理，不纳入自动替换。

## 7. 验收标准

### 架构

- `lib/workflows/presales/` 只承载固定售前工作流。
- `lib/agents/` 中每个目录都是具有 tools 和 stop condition 的真正 tool-loop agent。
- Route 不再包含大段 agent orchestration。
- client dependency graph 不包含 `supabase/server`、模型密钥或 server-only workflow。

### 行为兼容

- run/stream 使用同一输入准备和相同项目描述。
- SSE 保持 `progress / complete / error` 以及 `X-Agent-Execution-Id`。
- complete 仍只在事务提交后发送。
- begin/commit/finish RPC、取消/超时分类和项目状态恢复不变。
- Langfuse 根 trace 及关键 observation 名称保持可关联。
- 不改变成本计算结果。

### 工程验证

- TypeScript 检查通过。
- 本轮涉及文件 ESLint 通过。
- 全量 lint 的历史问题单独记录，不混入目录迁移。
- 经批准后可运行 build，确认 server/client 边界。
- 全仓活代码不再 import 旧路径；只允许 shim 和冻结资产保留旧字符串。

### 资产验证

- 旧软著和 evidence 文件 hash 不变。
- 新生成文件使用新名称或版本目录。
- `SOURCE_FILES` 中路径全部存在。

## 8. 回滚策略

- 每个阶段独立提交，禁止把目录迁移、API 重命名、数据库改动和业务规则改动混成一个提交。
- 阶段 1–2 可将 imports 切回旧 shim，不回滚数据库 schema。
- 阶段 3 可让 routes 临时重新导入旧 orchestration，API URL 不变。
- 文档和生成脚本单独提交；任何生成异常都不覆盖冻结资产。

## 9. 明确不在迁移中处理

- 不修改成本计算公式。
- 不顺带实施 Breakdown 的分批结构化重写。
- 不重命名数据库 `p_agent_type = 'presales_estimation'`。
- 不重命名 `/api/agent/*`。
- 不删除或重写历史软著、evidence 和日志。
- 未获用户批准前，不执行任何目录移动。

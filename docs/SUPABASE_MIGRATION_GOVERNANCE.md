# 云 Supabase 数据库迁移治理

> 建立日期：2026-07-28  
> 目标项目：`presales-agent`（project ref：`wroyjvsryyfzdhbexskr`）  
> 适用范围：已链接的云 Supabase；不依赖本地 Docker，也不引入云端测试环境。

## 1. 标准流程

迁移文件必须使用唯一的 14 位 UTC 时间戳：

```text
YYYYMMDDHHMMSS_description.sql
```

日常命令：

```bash
# 创建新迁移
pnpm db:migrations:new <description>

# 检查命名与版本唯一性
pnpm db:migrations:validate

# 对比本地文件与远程 migration history
pnpm db:migrations:list

# 预检将要执行的迁移，不修改数据库
pnpm db:migrations:check

# 审核预检结果后，正式执行云数据库迁移
pnpm db:migrations:push
```

`db:migrations:check` 只是 preflight，不是部署命令；它不会代替 `db:migrations:push`。

如果当前网络无法稳定访问 Supabase direct database host，可临时通过项目的 Session Pooler 执行相同 CLI 命令。数据库密码只从本地环境变量读取，不写入命令文档、仓库或日志。

## 2. 历史版本映射

| 原文件名 | 新文件名 | 排序依据 |
|---|---|---|
| `20260107010239_add_missing_rls_policies.sql` | 保持不变 | 已符合唯一 14 位版本 |
| `20260126_add_chat_sessions.sql` | `20260126090000_add_chat_sessions.sql` | 独立建表 |
| `20260126_add_elicitation_sessions.sql` | `20260126090100_add_elicitation_sessions.sql` | 先创建 Elicitation 表 |
| `20260126_enhance_elicitation.sql` | `20260126090200_enhance_elicitation.sql` | 依赖 Elicitation 表 |
| `20260127_update_elicitation_for_dynamic_questions.sql` | `20260127090000_update_elicitation_for_dynamic_questions.sql` | 依赖 Elicitation Session |
| `20260129_add_dynamic_roles.sql` | `20260129090000_add_dynamic_roles.sql` | 提供后续 Agent 持久化依赖表和列 |
| `20260305_add_estimate_references.sql` | `20260305090000_add_estimate_references.sql` | 先创建估算参考表 |
| `20260305_add_vector_search.sql` | `20260305090100_add_vector_search.sql` | 依赖估算参考表 |
| `20260305_add_function_categories.sql` | `20260305090200_add_function_categories.sql` | 独立功能分类 |
| `20260305_add_quick_estimates.sql` | `20260305090300_add_quick_estimates.sql` | 独立快速估算 |
| `20260306_add_function_groups.sql` | `20260306090000_add_function_groups.sql` | 先创建功能组及初始策略 |
| `20260306_add_function_library_rls.sql` | `20260306090100_add_function_library_rls.sql` | 功能库 RLS |
| `20260306_fix_function_group_items_rls.sql` | `20260728100000_fix_function_group_items_rls.sql` | 依赖功能组初始策略；生产审计确认尚未应用，放在生产基线之后以便标准 push |
| `20260728_add_agent_execution_atomic_persistence.sql` | `20260728090000_add_agent_execution_atomic_persistence.sql` | 当日实际先执行 |
| `20260728_unify_elicitation_finalization.sql` | `20260728090100_unify_elicitation_finalization.sql` | 当日实际后执行 |

重命名时已逐份比较 SHA-256，12 份已跟踪历史迁移的新旧内容完全一致；两份 `20260728` 迁移只分配唯一版本号，没有重放 SQL。

## 3. 生产基线审计结果

2026-07-28 使用生产 `public` schema-only dump 对 15 份迁移逐项核对：

- 10 份的目标 schema 已验证一致或实质等价。
- 4 份的 schema 已对齐，但 schema-only dump 不能证明历史数据副作用：
  - `20260129090000`：旧 `function_modules.role_estimates` 数据回填。
  - `20260305090100`：dump 未包含 `extensions` schema；生产已另行确认 `vector` 扩展存在。
  - `20260305090200`：13 条预制功能分类 seed。
  - `20260728090000`：迁移执行时的 stale execution 数据收敛；当前已验证无非法记录、无 running 记录和无重复 running 项目。
- `20260728100000` 存在明确生产漂移，不能 repair 为 applied：
  - 迁移目标允许任意认证用户维护非预设功能组。
  - 生产仍保留 owner-only 策略，只允许创建者维护。
  - 该迁移会扩大生产写权限，必须单独做业务和安全确认后才能执行。

这里的 `repair --status applied` 表示“接受当前生产状态作为迁移基线”，不是证明每份历史 SQL 曾由 Supabase CLI 原样执行。

## 4. 首次 migration history 校准记录

远程原本没有已应用版本。2026-07-28 已在获得生产写操作确认后，将通过 schema 基线审计的 14 个版本写入 migration history；明确排除了存在权限语义差异的 `20260728100000`：

```text
20260107010239
20260126090000
20260126090100
20260126090200
20260127090000
20260129090000
20260305090000
20260305090100
20260305090200
20260305090300
20260306090000
20260306090100
20260728090000
20260728090100
```

校准时，项目内置 Supabase CLI 2.67.1 首次读取一份含无效 UTF-8 字节的旧迁移失败。修复该文件的损坏注释并加入 UTF-8 校验后，使用以下标准 CLI 命令将 14 个版本标记为 applied；该命令只更新 migration history，不执行迁移 SQL：

```bash
supabase migration repair \
  20260107010239 \
  20260126090000 \
  20260126090100 \
  20260126090200 \
  20260127090000 \
  20260129090000 \
  20260305090000 \
  20260305090100 \
  20260305090200 \
  20260305090300 \
  20260306090000 \
  20260306090100 \
  20260728090000 \
  20260728090100 \
  --status applied
```

该命令只校准 `supabase_migrations.schema_migrations`，没有执行上述迁移 SQL。

校准后必须执行：

```bash
pnpm db:migrations:list
pnpm db:migrations:check
```

验证结果：

1. `migration list` 显示本地和远程的 14 个基线版本全部对齐。
2. 未部署的 RLS 文件已改为基线后的新版本 `20260728100000`，使标准 dry-run 无需 `--include-all` 即可识别它。
3. dry-run 只显示 `20260728100000_fix_function_group_items_rls.sql`，没有重放其他历史迁移。
4. 在该 RLS 迁移获得单独批准前，不执行 `db:migrations:push`，也不把它虚假标记为 applied。

## 5. 后续规则

1. 禁止手工执行迁移后不记录 history；紧急直执行必须在同一变更中补充审计和 repair 记录。
2. 禁止重复版本号、8 位日期版本和重命名已被标准 history 管理的版本。
3. 每次部署先运行 `validate`、`list`、`check`，审核待执行文件后再运行 `push`。
4. dry-run 显示意外历史迁移时立即停止，不使用 `--include-all` 绕过漂移。
5. `migration repair` 只用于经过 schema/数据审计的历史校准，不作为日常部署方式。
6. 涉及 RLS、ACL、`SECURITY DEFINER`、数据删除或不可逆数据变换的迁移必须单独审查。

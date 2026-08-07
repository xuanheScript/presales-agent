# Linked Supabase 云测试安全约定

本目录中的数据库集成测试默认关闭；缺少凭据时必须由 Vitest 安全跳过。环境守卫只在 `RUN_DATABASE_INTEGRATION=1` 时读取和验证其余配置。启用后任何缺失、歧义或不一致配置都会在创建 Supabase client 之前失败（fail-close）。

## 必需环境变量

```bash
RUN_DATABASE_INTEGRATION=1
SUPABASE_TEST_PROJECT_REF=<20 位云测试项目 ref>
SUPABASE_TEST_PROJECT_REF_ALLOWLIST=<逗号分隔、经批准的测试项目 ref>
SUPABASE_TEST_URL=https://<SUPABASE_TEST_PROJECT_REF>.supabase.co
SUPABASE_TEST_ANON_KEY=<测试项目 anon/publishable key>
SUPABASE_TEST_SERVICE_ROLE_KEY=<测试项目 service_role/secret key>
SUPABASE_TEST_USER_EMAIL=<专用已认证测试用户>
SUPABASE_TEST_USER_PASSWORD=<专用已认证测试用户密码>
```

不要将真实值写入仓库或命令历史。推荐由本地未跟踪环境文件或 CI secret 注入。测试项目 ref 必须同时满足：

1. 在 `SUPABASE_TEST_PROJECT_REF_ALLOWLIST` 中；
2. 与 URL 的 `<ref>.supabase.co` 主机严格一致；
3. 不等于 `supabase/.temp/project-ref` 中当前 linked ref。当前 linked 项目按可能为生产处理。

环境守卫不运行迁移、`db reset`、`db push`、`migration repair`、truncate 或任何全表清理。

## 测试隔离和客户端边界

每次启用会生成唯一 `runId`。所有 fixture 都应在可查询字段中写入该值，并且 cleanup 必须只删除同一个 `runId` 创建的记录；禁止无过滤 delete、truncate 或清理其他运行的数据。

- `fixtureAdminClient` 使用 service role，只允许创建本次 fixture 和按本次 `runId` 精确 cleanup。不要用它断言 RLS。
- `rlsAuthenticatedClient` 使用 anon key，并通过专用测试用户登录。所有 RLS 行为断言必须使用该客户端。
- 测试应采用 `try/finally` 清理；如果无法证明过滤条件只命中本次 run，则宁可保留 fixture，也不要扩大删除范围。

## 运行

守卫单测不需要云凭据，也不会访问数据库：

```bash
pnpm exec vitest run tests/integration/database/test-environment.test.ts
```

实际数据库测试文件应在模块加载时调用 `loadDatabaseTestEnvironment()`，并用 `describe.skipIf(!environment.enabled)` 安全跳过。这样无显式 opt-in 时不访问云端，而启用但配置错误时测试收集直接失败。

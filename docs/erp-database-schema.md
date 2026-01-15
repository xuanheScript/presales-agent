# 售前成本估算系统 - 数据库表结构

基于 Supabase (PostgreSQL)，共有 **6 张表**。

---

## 1. projects（项目表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PRIMARY KEY | 项目ID，自动生成 |
| name | TEXT | NOT NULL | 项目名称 |
| description | TEXT | - | 项目描述 |
| industry | TEXT | - | 行业 |
| status | TEXT | NOT NULL, DEFAULT 'draft' | 状态：draft/analyzing/completed/archived |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | 创建时间 |
| updated_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | 更新时间 |
| created_by | UUID | FK → profiles(id) | 创建人 |

---

## 2. requirements（需求表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PRIMARY KEY | 需求ID |
| project_id | UUID | NOT NULL, FK → projects(id) | 关联项目 |
| raw_content | TEXT | NOT NULL | 原始需求内容 |
| parsed_content | JSONB | - | 解析后的内容 |
| file_url | TEXT | - | 文件URL |
| requirement_type | TEXT | NOT NULL, DEFAULT 'text' | 类型：text/document/template |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | 创建时间 |

---

## 3. function_modules（功能模块表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PRIMARY KEY | 模块ID |
| project_id | UUID | NOT NULL, FK → projects(id) | 关联项目 |
| module_name | TEXT | NOT NULL | 模块名称 |
| function_name | TEXT | NOT NULL | 功能名称 |
| description | TEXT | - | 描述 |
| difficulty_level | TEXT | NOT NULL, DEFAULT 'medium' | 难度：simple/medium/complex/very_complex |
| estimated_hours | DECIMAL(10,2) | NOT NULL, DEFAULT 0 | 预估工时 |
| dependencies | TEXT[] | - | 依赖项（数组） |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | 创建时间 |

---

## 4. cost_estimates（成本估算表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PRIMARY KEY | 估算ID |
| project_id | UUID | NOT NULL, FK → projects(id) | 关联项目 |
| labor_cost | DECIMAL(12,2) | NOT NULL, DEFAULT 0 | 人工成本 |
| service_cost | DECIMAL(12,2) | NOT NULL, DEFAULT 0 | 服务成本 |
| infrastructure_cost | DECIMAL(12,2) | NOT NULL, DEFAULT 0 | 基础设施成本 |
| buffer_percentage | DECIMAL(5,2) | NOT NULL, DEFAULT 15 | 风险缓冲百分比 |
| total_cost | DECIMAL(12,2) | NOT NULL, DEFAULT 0 | 总成本 |
| breakdown | JSONB | NOT NULL, DEFAULT '{}' | 成本明细 |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | 创建时间 |
| updated_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | 更新时间 |

---

## 5. system_config（系统配置表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PRIMARY KEY | 配置ID |
| default_labor_cost_per_day | DECIMAL(12,2) | NOT NULL, DEFAULT 1500 | 默认日人工成本 |
| default_risk_buffer_percentage | DECIMAL(5,2) | NOT NULL, DEFAULT 15 | 默认风险缓冲% |
| currency | TEXT | NOT NULL, DEFAULT 'CNY' | 货币单位 |
| updated_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | 更新时间 |
| updated_by | UUID | FK → profiles(id) | 更新人 |

---

## 6. agent_executions（Agent 执行记录表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PRIMARY KEY | 执行ID |
| project_id | UUID | NOT NULL, FK → projects(id) | 关联项目 |
| agent_type | TEXT | NOT NULL | Agent 类型 |
| input_data | JSONB | NOT NULL | 输入数据 |
| output_data | JSONB | - | 输出数据 |
| status | TEXT | NOT NULL, DEFAULT 'running' | 状态：running/completed/failed |
| error_message | TEXT | - | 错误信息 |
| execution_time_ms | INTEGER | - | 执行耗时(毫秒) |
| created_at | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | 创建时间 |
| completed_at | TIMESTAMP WITH TIME ZONE | - | 完成时间 |

---

## 表关系图

```
profiles (外部表)
    ↑
    │ created_by / updated_by
    │
projects ←────────────────────────────────┐
    │                                      │
    ├──→ requirements (1:N)                │
    ├──→ function_modules (1:N)            │
    ├──→ cost_estimates (1:N)              │
    └──→ agent_executions (1:N)            │
                                           │
system_config ─────────────────────────────┘
```

---

## 索引

| 索引名 | 表 | 字段 |
|--------|-----|------|
| idx_projects_created_by | projects | created_by |
| idx_projects_status | projects | status |
| idx_requirements_project_id | requirements | project_id |
| idx_function_modules_project_id | function_modules | project_id |
| idx_cost_estimates_project_id | cost_estimates | project_id |
| idx_agent_executions_project_id | agent_executions | project_id |

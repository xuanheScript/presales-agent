-- ============================================
-- 功能组种子数据
-- 依赖 function_library 表中的种子数据
-- is_preset = TRUE 标记为系统预设组
-- item_count / total_standard_hours 由触发器自动维护
-- ============================================

-- 清空现有功能组数据
TRUNCATE TABLE function_group_items CASCADE;
TRUNCATE TABLE function_groups CASCADE;

-- ============================================
-- 1. 电商基础套餐
-- ============================================
INSERT INTO function_groups (name, description, is_preset)
VALUES (
  '电商基础套餐',
  '电商系统的核心功能集合：用户注册登录、商品展示、购物车、订单管理、支付集成',
  TRUE
);

INSERT INTO function_group_items (group_id, function_library_id, sort_order)
SELECT
  (SELECT id FROM function_groups WHERE name = '电商基础套餐'),
  fl.id,
  row_number() OVER (ORDER BY fl.category, fl.function_name) - 1
FROM function_library fl
WHERE (fl.function_name, fl.category) IN (
  ('用户注册', '用户管理'),
  ('用户登录', '用户管理'),
  ('用户信息管理', '用户管理'),
  ('购物车', '订单管理'),
  ('订单创建', '订单管理'),
  ('订单列表与详情', '订单管理'),
  ('订单状态流转', '订单管理'),
  ('退款/售后', '订单管理'),
  ('微信支付', '支付系统'),
  ('支付宝支付', '支付系统')
);

-- ============================================
-- 2. 企业后台管理基础包
-- ============================================
INSERT INTO function_groups (name, description, is_preset)
VALUES (
  '企业后台管理基础包',
  '企业级后台管理系统必备功能：用户管理、权限控制、操作日志、数据导出',
  TRUE
);

INSERT INTO function_group_items (group_id, function_library_id, sort_order)
SELECT
  (SELECT id FROM function_groups WHERE name = '企业后台管理基础包'),
  fl.id,
  row_number() OVER (ORDER BY fl.category, fl.function_name) - 1
FROM function_library fl
WHERE (fl.function_name, fl.category) IN (
  ('用户注册', '用户管理'),
  ('用户登录', '用户管理'),
  ('用户列表与检索', '用户管理'),
  ('角色管理', '权限系统'),
  ('菜单权限', '权限系统'),
  ('按钮级权限', '权限系统'),
  ('操作审计', '权限系统'),
  ('数据看板', '数据分析'),
  ('Excel导出', '报表系统')
);

-- ============================================
-- 3. 内容平台基础包
-- ============================================
INSERT INTO function_groups (name, description, is_preset)
VALUES (
  '内容平台基础包',
  '内容管理平台核心功能：文章管理、富文本编辑、分类标签、评论系统、搜索',
  TRUE
);

INSERT INTO function_group_items (group_id, function_library_id, sort_order)
SELECT
  (SELECT id FROM function_groups WHERE name = '内容平台基础包'),
  fl.id,
  row_number() OVER (ORDER BY fl.category, fl.function_name) - 1
FROM function_library fl
WHERE (fl.function_name, fl.category) IN (
  ('富文本编辑器', '内容管理'),
  ('文章/资讯管理', '内容管理'),
  ('分类与标签', '内容管理'),
  ('评论系统', '内容管理'),
  ('Banner/轮播管理', '内容管理'),
  ('基础搜索', '搜索功能'),
  ('搜索建议/联想', '搜索功能')
);

-- ============================================
-- 4. OA 审批工作流包
-- ============================================
INSERT INTO function_groups (name, description, is_preset)
VALUES (
  'OA审批工作流包',
  'OA 办公自动化核心：审批流引擎、表单设计、待办已办、催办提醒',
  TRUE
);

INSERT INTO function_group_items (group_id, function_library_id, sort_order)
SELECT
  (SELECT id FROM function_groups WHERE name = 'OA审批工作流包'),
  fl.id,
  row_number() OVER (ORDER BY fl.category, fl.function_name) - 1
FROM function_library fl
WHERE (fl.function_name, fl.category) IN (
  ('审批流引擎', '工作流'),
  ('表单设计器', '工作流'),
  ('流程设计器', '工作流'),
  ('待办/已办', '工作流'),
  ('流程催办', '工作流'),
  ('请假/报销等模板', '工作流')
);

-- ============================================
-- 5. 消息通知全渠道包
-- ============================================
INSERT INTO function_groups (name, description, is_preset)
VALUES (
  '消息通知全渠道包',
  '覆盖全渠道消息推送：站内信、短信、邮件、微信、APP推送、WebSocket',
  TRUE
);

INSERT INTO function_group_items (group_id, function_library_id, sort_order)
SELECT
  (SELECT id FROM function_groups WHERE name = '消息通知全渠道包'),
  fl.id,
  row_number() OVER (ORDER BY fl.category, fl.function_name) - 1
FROM function_library fl
WHERE (fl.function_name, fl.category) IN (
  ('站内信', '通知系统'),
  ('短信通知', '通知系统'),
  ('邮件通知', '通知系统'),
  ('微信公众号推送', '通知系统'),
  ('APP推送', '通知系统'),
  ('通知偏好设置', '通知系统'),
  ('消息中心', '通知系统'),
  ('WebSocket实时推送', '通知系统')
);

-- ============================================
-- 6. 数据分析完整包
-- ============================================
INSERT INTO function_groups (name, description, is_preset)
VALUES (
  '数据分析完整包',
  '企业数据分析全功能：看板、报表、大屏、埋点、监控',
  TRUE
);

INSERT INTO function_group_items (group_id, function_library_id, sort_order)
SELECT
  (SELECT id FROM function_groups WHERE name = '数据分析完整包'),
  fl.id,
  row_number() OVER (ORDER BY fl.category, fl.function_name) - 1
FROM function_library fl
WHERE (fl.function_name, fl.category) IN (
  ('数据看板', '数据分析'),
  ('统计报表', '数据分析'),
  ('数据导出', '数据分析'),
  ('埋点管理', '数据分析'),
  ('业务指标监控', '数据分析'),
  ('数据大屏', '数据分析'),
  ('自助查询', '数据分析')
);

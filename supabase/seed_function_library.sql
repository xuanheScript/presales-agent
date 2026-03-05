-- ============================================
-- 标准功能库种子数据
-- 执行前会清空 function_library 表全部数据
-- ============================================

-- 清空现有数据
TRUNCATE TABLE function_library CASCADE;

-- ============================================
-- 用户管理
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('用户注册', '用户管理', '手机号/邮箱注册，含验证码发送与校验', 16, NULL, '{"sms_verify": 1.2, "email_verify": 1.1, "captcha": 1.15}'),
('用户登录', '用户管理', '账号密码登录，含登录态管理与安全策略', 12, NULL, '{"remember_me": 1.1, "login_limit": 1.2, "device_trust": 1.3}'),
('第三方登录', '用户管理', '微信/支付宝/钉钉等第三方OAuth登录', 20, NULL, '{"wechat": 1.0, "alipay": 1.1, "dingtalk": 1.1, "apple": 1.2}'),
('用户信息管理', '用户管理', '个人资料编辑、头像上传、实名认证', 16, NULL, '{"avatar_upload": 1.1, "real_name_auth": 1.4, "id_card_ocr": 1.5}'),
('密码管理', '用户管理', '修改密码、找回密码、密码强度校验', 12, NULL, '{"sms_reset": 1.1, "email_reset": 1.1, "security_question": 1.2}'),
('用户列表与检索', '用户管理', '后台用户列表查询、筛选、导出', 12, NULL, '{"advanced_filter": 1.2, "export_excel": 1.15, "batch_operation": 1.3}'),
('用户状态管理', '用户管理', '启用/禁用/注销账户、黑名单管理', 8, NULL, '{"blacklist": 1.2, "auto_disable": 1.3}'),
('用户标签与分组', '用户管理', '用户打标签、分组管理、用户画像', 16, NULL, '{"auto_tagging": 1.4, "user_portrait": 1.5}'),
('用户操作日志', '用户管理', '记录用户关键操作行为，支持审计追溯', 12, NULL, '{"realtime_log": 1.2, "log_export": 1.1}'),
('多租户用户隔离', '用户管理', '支持SaaS多租户场景下的用户数据隔离', 24, NULL, '{"tenant_switch": 1.3, "data_isolation": 1.4}');

-- ============================================
-- 权限系统
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('角色管理', '权限系统', '角色的增删改查，角色与用户的绑定关系', 16, NULL, '{"role_hierarchy": 1.3, "default_roles": 1.1}'),
('菜单权限', '权限系统', '基于角色的菜单可见性控制', 16, NULL, '{"dynamic_menu": 1.2, "menu_icon": 1.05}'),
('按钮级权限', '权限系统', '页面内操作按钮的细粒度权限控制', 12, NULL, '{"directive_control": 1.1, "api_guard": 1.2}'),
('数据权限', '权限系统', '基于组织架构或自定义规则的数据行级过滤', 24, NULL, '{"org_based": 1.2, "custom_rule": 1.5, "field_level": 1.4}'),
('组织架构管理', '权限系统', '部门/团队的树形管理，人员归属调整', 20, NULL, '{"multi_level": 1.2, "drag_sort": 1.15, "batch_adjust": 1.2}'),
('权限审批流', '权限系统', '权限申请、审批、自动回收的完整流程', 24, NULL, '{"auto_revoke": 1.2, "approval_chain": 1.3}'),
('操作审计', '权限系统', '敏感操作的审计日志记录与查询', 16, NULL, '{"sensitive_alert": 1.3, "export_audit": 1.1}'),
('API鉴权', '权限系统', 'API接口的Token/签名鉴权机制', 16, NULL, '{"jwt": 1.0, "oauth2": 1.3, "api_key": 1.1, "signature": 1.2}');

-- ============================================
-- 订单管理
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('订单创建', '订单管理', '商品/服务选择、下单、订单号生成', 16, NULL, '{"multi_item": 1.2, "coupon_apply": 1.3, "address_select": 1.15}'),
('订单列表与详情', '订单管理', '订单列表查询、多条件筛选、详情查看', 12, NULL, '{"advanced_search": 1.2, "timeline_view": 1.15}'),
('订单状态流转', '订单管理', '订单全生命周期状态机管理（待付款→已付款→已发货→已完成等）', 20, NULL, '{"custom_flow": 1.3, "auto_cancel": 1.2, "timeout_handler": 1.25}'),
('退款/售后', '订单管理', '退款申请、审核、退货退款流程处理', 24, NULL, '{"partial_refund": 1.3, "return_logistics": 1.4, "auto_refund": 1.2}'),
('订单导出', '订单管理', '订单数据批量导出Excel/CSV，支持自定义字段', 8, NULL, '{"custom_fields": 1.2, "async_export": 1.3}'),
('购物车', '订单管理', '加入购物车、数量修改、批量结算', 16, NULL, '{"sku_select": 1.2, "stock_check": 1.15, "price_calculate": 1.2}'),
('订单评价', '订单管理', '用户对订单/商品进行评价、评分', 12, NULL, '{"image_upload": 1.2, "auto_review": 1.3}'),
('发票管理', '订单管理', '电子发票申请、开具、查询、下载', 16, NULL, '{"e_invoice": 1.2, "tax_calculate": 1.3, "batch_invoice": 1.2}'),
('库存联动', '订单管理', '下单/退款时自动扣减/恢复库存', 16, NULL, '{"realtime_stock": 1.3, "oversell_prevent": 1.4}');

-- ============================================
-- 支付系统
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('微信支付', '支付系统', '微信JSAPI/Native/H5/小程序支付集成', 20, NULL, '{"jsapi": 1.0, "native_qr": 1.1, "h5": 1.15, "miniapp": 1.1}'),
('支付宝支付', '支付系统', '支付宝网页/APP/当面付支付集成', 20, NULL, '{"web_pay": 1.0, "app_pay": 1.15, "face_pay": 1.2}'),
('支付回调与对账', '支付系统', '支付结果异步通知处理、定时对账', 16, NULL, '{"auto_reconcile": 1.3, "exception_handle": 1.2}'),
('退款处理', '支付系统', '原路退款、部分退款、退款状态追踪', 16, NULL, '{"partial_refund": 1.2, "refund_audit": 1.2}'),
('账户余额', '支付系统', '用户钱包/余额系统，充值与消费', 24, NULL, '{"recharge": 1.2, "withdraw": 1.4, "balance_lock": 1.3}'),
('支付渠道管理', '支付系统', '多支付渠道的统一配置与切换', 12, NULL, '{"channel_switch": 1.2, "rate_config": 1.15}'),
('交易流水', '支付系统', '支付/退款流水记录查询与导出', 12, NULL, '{"detail_view": 1.1, "export": 1.15}'),
('分账', '支付系统', '订单金额按规则分配给多个收款方', 24, NULL, '{"auto_split": 1.3, "multi_merchant": 1.4, "settle_cycle": 1.3}');

-- ============================================
-- 内容管理
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('富文本编辑器', '内容管理', '集成富文本编辑器（图文混排、表格、代码块等）', 16, NULL, '{"image_paste": 1.15, "video_embed": 1.3, "markdown": 1.2}'),
('文章/资讯管理', '内容管理', '文章的发布、编辑、上下架、排序', 16, NULL, '{"schedule_publish": 1.2, "version_history": 1.3, "seo": 1.15}'),
('分类与标签', '内容管理', '内容分类树管理、标签体系维护', 12, NULL, '{"multi_level_cat": 1.2, "tag_recommend": 1.3}'),
('Banner/轮播管理', '内容管理', '首页轮播图、广告位配置管理', 8, NULL, '{"schedule": 1.2, "ab_test": 1.4}'),
('评论系统', '内容管理', '用户评论、回复、敏感词过滤', 16, NULL, '{"nested_reply": 1.2, "sensitive_filter": 1.3, "like_system": 1.15}'),
('CMS页面搭建', '内容管理', '可视化拖拽搭建落地页/活动页', 40, NULL, '{"drag_drop": 1.0, "component_lib": 1.3, "template_market": 1.4}'),
('内容审核', '内容管理', '人工/AI内容审核，违规内容拦截', 20, NULL, '{"ai_review": 1.4, "manual_queue": 1.2, "appeal_flow": 1.3}'),
('多语言管理', '内容管理', '内容的多语言版本管理与切换', 20, NULL, '{"auto_translate": 1.4, "rtl_support": 1.3}');

-- ============================================
-- 数据分析
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('数据看板', '数据分析', '核心指标的可视化仪表盘展示', 24, NULL, '{"realtime": 1.3, "custom_layout": 1.2, "drill_down": 1.4}'),
('用户行为分析', '数据分析', '用户访问路径、页面停留、行为漏斗分析', 32, NULL, '{"funnel": 1.2, "heatmap": 1.4, "session_replay": 1.5}'),
('统计报表', '数据分析', '业务数据按日/周/月统计，支持图表展示', 20, NULL, '{"chart_types": 1.2, "comparison": 1.15, "trend_line": 1.1}'),
('数据导出', '数据分析', '统计结果导出为Excel/PDF/图片', 8, NULL, '{"pdf_report": 1.3, "scheduled_export": 1.3}'),
('埋点管理', '数据分析', '前端埋点方案设计、埋点数据采集', 20, NULL, '{"auto_track": 1.3, "custom_event": 1.2, "ab_experiment": 1.4}'),
('业务指标监控', '数据分析', '关键业务指标的阈值告警与趋势监控', 20, NULL, '{"threshold_alert": 1.2, "anomaly_detect": 1.5}'),
('数据大屏', '数据分析', '全屏数据可视化大屏，适配投屏展示', 32, NULL, '{"map_visual": 1.3, "realtime_refresh": 1.2, "multi_screen": 1.3}'),
('自助查询', '数据分析', '业务人员可自主配置查询条件和展示维度', 24, NULL, '{"drag_dimension": 1.3, "save_template": 1.2}');

-- ============================================
-- 通知系统
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('站内信', '通知系统', '系统内消息通知，已读/未读状态管理', 16, NULL, '{"batch_send": 1.2, "message_template": 1.15}'),
('短信通知', '通知系统', '对接短信平台发送验证码/业务通知', 12, NULL, '{"multi_vendor": 1.2, "template_manage": 1.15, "send_limit": 1.1}'),
('邮件通知', '通知系统', '邮件模板管理与发送（注册确认/订单通知等）', 12, NULL, '{"html_template": 1.2, "attachment": 1.15, "batch_send": 1.2}'),
('微信公众号推送', '通知系统', '通过微信公众号模板消息/订阅消息推送', 16, NULL, '{"template_msg": 1.0, "subscribe_msg": 1.2}'),
('APP推送', '通知系统', '移动端推送通知（极光/个推/Firebase等）', 16, NULL, '{"jpush": 1.0, "getui": 1.0, "fcm": 1.15, "badge_count": 1.1}'),
('通知偏好设置', '通知系统', '用户可自定义接收通知的渠道与类型', 12, NULL, '{"channel_select": 1.1, "quiet_hours": 1.2}'),
('消息中心', '通知系统', '统一的消息列表、分类查看、全部已读', 16, NULL, '{"category_tab": 1.1, "infinite_scroll": 1.1}'),
('WebSocket实时推送', '通知系统', 'WebSocket长连接实现实时消息推送', 20, NULL, '{"reconnect": 1.2, "heartbeat": 1.1, "room_channel": 1.3}');

-- ============================================
-- 搜索功能
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('基础搜索', '搜索功能', '关键词模糊搜索，支持多字段检索', 8, NULL, '{"multi_field": 1.15, "highlight": 1.1}'),
('全文检索', '搜索功能', '基于Elasticsearch/MeiliSearch的全文检索引擎', 24, NULL, '{"elasticsearch": 1.0, "meilisearch": 1.0, "chinese_segment": 1.2}'),
('搜索建议/联想', '搜索功能', '输入时实时展示搜索建议与热词', 12, NULL, '{"hot_words": 1.1, "history_suggest": 1.15, "pinyin_match": 1.2}'),
('高级筛选', '搜索功能', '多维度组合筛选（价格区间、日期范围、多选标签等）', 16, NULL, '{"range_filter": 1.1, "tag_filter": 1.1, "save_filter": 1.2}'),
('搜索结果排序', '搜索功能', '按相关度/时间/热度等多维度排序', 8, NULL, '{"custom_weight": 1.3, "boost_rule": 1.2}'),
('搜索分析', '搜索功能', '搜索关键词统计、无结果词分析', 12, NULL, '{"keyword_stats": 1.2, "zero_result_alert": 1.2}');

-- ============================================
-- 文件管理
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('文件上传', '文件管理', '单文件/多文件上传，支持拖拽、进度展示', 12, NULL, '{"drag_upload": 1.1, "chunk_upload": 1.3, "resume_upload": 1.4}'),
('图片处理', '文件管理', '图片压缩、裁剪、缩略图生成、水印', 16, NULL, '{"crop_tool": 1.2, "watermark": 1.15, "format_convert": 1.1}'),
('文件存储对接', '文件管理', '对接OSS/S3/MinIO等对象存储服务', 12, NULL, '{"aliyun_oss": 1.0, "aws_s3": 1.1, "minio": 1.1, "cdn_accelerate": 1.15}'),
('文件预览', '文件管理', '在线预览PDF/Word/Excel/图片/视频等文件', 20, NULL, '{"pdf_preview": 1.1, "office_preview": 1.3, "video_player": 1.2}'),
('文件夹管理', '文件管理', '类网盘的文件夹树形结构管理', 16, NULL, '{"nested_folder": 1.2, "move_copy": 1.15, "share_link": 1.3}'),
('文件权限控制', '文件管理', '按角色/用户控制文件的查看/下载/编辑权限', 16, NULL, '{"role_based": 1.2, "link_expiry": 1.15, "download_log": 1.1}'),
('附件管理', '文件管理', '业务单据的附件关联、批量下载', 8, NULL, '{"batch_download": 1.15, "zip_package": 1.1}'),
('视频管理', '文件管理', '视频上传、转码、切片、播放', 24, NULL, '{"transcode": 1.3, "hls_stream": 1.3, "progress_track": 1.2}');

-- ============================================
-- 报表系统
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('报表模板配置', '报表系统', '可配置的报表模板，支持字段、分组、汇总规则', 24, NULL, '{"drag_config": 1.3, "formula_engine": 1.4}'),
('Excel导出', '报表系统', '结构化数据导出为格式化的Excel文件', 8, NULL, '{"styled_export": 1.2, "multi_sheet": 1.15, "chart_in_excel": 1.3}'),
('PDF报表', '报表系统', '生成带公司抬头的正式PDF报表', 16, NULL, '{"header_footer": 1.15, "page_number": 1.05, "watermark": 1.1}'),
('定时报表', '报表系统', '按日/周/月自动生成并发送报表', 16, NULL, '{"cron_schedule": 1.2, "email_delivery": 1.15, "multi_recipient": 1.1}'),
('交叉报表', '报表系统', '行列交叉的数据透视表展示', 20, NULL, '{"pivot_table": 1.3, "sub_total": 1.2}'),
('报表权限', '报表系统', '按角色控制报表的查看和导出权限', 8, NULL, '{"field_mask": 1.2, "export_control": 1.15}'),
('打印排版', '报表系统', '报表打印预览与排版优化', 12, NULL, '{"page_break": 1.15, "landscape": 1.05, "barcode_print": 1.2}');

-- ============================================
-- 工作流
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('审批流引擎', '工作流', '可配置的多级审批流程引擎', 32, NULL, '{"parallel_approve": 1.3, "conditional_branch": 1.4, "countersign": 1.3}'),
('表单设计器', '工作流', '拖拽式动态表单设计，支持多种字段类型', 40, NULL, '{"drag_drop": 1.0, "field_validation": 1.2, "computed_field": 1.3, "sub_form": 1.4}'),
('流程设计器', '工作流', '可视化流程编排，支持条件分支、并行、会签', 40, NULL, '{"bpmn_standard": 1.3, "visual_designer": 1.0, "version_manage": 1.2}'),
('待办/已办', '工作流', '个人待办事项列表、已办事项回溯', 12, NULL, '{"urgent_mark": 1.1, "batch_approve": 1.2, "delegate": 1.2}'),
('流程催办', '工作流', '超时自动催办提醒，支持升级处理', 12, NULL, '{"auto_remind": 1.2, "escalation": 1.3}'),
('流程监控', '工作流', '管理员查看流程运行状态、处理瓶颈', 16, NULL, '{"bottleneck_alert": 1.3, "stats_dashboard": 1.2}'),
('请假/报销等模板', '工作流', '常见OA审批场景的预设模板', 16, NULL, '{"leave": 1.0, "expense": 1.15, "purchase": 1.2, "contract": 1.25}');

-- ============================================
-- 集成接口
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('RESTful API设计', '集成接口', '标准化的RESTful API接口设计与文档', 16, NULL, '{"swagger_doc": 1.15, "versioning": 1.2, "rate_limit": 1.2}'),
('微信生态对接', '集成接口', '公众号/小程序/企业微信的API对接', 20, NULL, '{"mp_bindding": 1.2, "miniapp_api": 1.15, "wecom": 1.3}'),
('钉钉集成', '集成接口', '钉钉消息推送、审批、通讯录同步', 20, NULL, '{"msg_push": 1.1, "approval_sync": 1.3, "contact_sync": 1.2}'),
('ERP对接', '集成接口', '与SAP/用友/金蝶等ERP系统数据同步', 32, NULL, '{"sap": 1.4, "yonyou": 1.2, "kingdee": 1.2, "realtime_sync": 1.3}'),
('物流接口', '集成接口', '对接快递鸟/快递100等物流查询API', 12, NULL, '{"multi_carrier": 1.2, "auto_subscribe": 1.15}'),
('地图服务', '集成接口', '高德/百度/腾讯地图API集成（定位/导航/围栏）', 16, NULL, '{"amap": 1.0, "bmap": 1.0, "geofence": 1.3, "route_plan": 1.2}'),
('OCR识别', '集成接口', '身份证/营业执照/发票等证件OCR识别', 16, NULL, '{"id_card": 1.0, "business_license": 1.15, "invoice": 1.2, "custom_template": 1.4}'),
('电子签章', '集成接口', '对接e签宝/法大大等电子签章服务', 24, NULL, '{"contract_sign": 1.2, "batch_sign": 1.3, "seal_manage": 1.2}'),
('SSO单点登录', '集成接口', '对接CAS/LDAP/SAML等企业SSO', 20, NULL, '{"cas": 1.2, "ldap": 1.2, "saml": 1.3, "oidc": 1.15}'),
('开放平台', '集成接口', '为第三方提供API，含密钥管理、调用统计', 32, NULL, '{"api_gateway": 1.3, "key_manage": 1.2, "quota_limit": 1.2, "webhook": 1.15}');

-- ============================================
-- 其他
-- ============================================
INSERT INTO function_library (function_name, category, description, standard_hours, reference_cost, complexity_factors) VALUES
('系统配置管理', '其他', '系统参数的可视化配置（如邮件服务器、存储配置等）', 12, NULL, '{"encrypted_config": 1.2, "hot_reload": 1.3}'),
('数据字典', '其他', '系统全局的枚举值/字典项管理', 8, NULL, '{"cascade_dict": 1.2, "cache_strategy": 1.15}'),
('定时任务管理', '其他', '后台定时任务的配置、执行记录、手动触发', 16, NULL, '{"cron_editor": 1.15, "retry_policy": 1.2, "distributed_lock": 1.3}'),
('日志管理', '其他', '系统运行日志的采集、查询、告警', 16, NULL, '{"elk_stack": 1.3, "log_level_filter": 1.1, "alert_rule": 1.2}'),
('数据备份与恢复', '其他', '数据库定期备份、手动备份、一键恢复', 16, NULL, '{"auto_backup": 1.2, "point_in_time": 1.4, "cross_region": 1.3}'),
('多语言/国际化', '其他', '系统界面的多语言切换支持', 20, NULL, '{"auto_detect": 1.15, "rtl_layout": 1.3, "date_format": 1.1}'),
('导入功能', '其他', 'Excel/CSV数据批量导入，含数据校验与错误提示', 16, NULL, '{"template_download": 1.1, "progress_bar": 1.15, "error_report": 1.2, "large_file": 1.3}'),
('数据脱敏', '其他', '敏感数据（手机号/身份证/银行卡）的展示脱敏', 8, NULL, '{"custom_rule": 1.2, "api_mask": 1.15}'),
('操作引导/帮助', '其他', '新手引导、功能说明、帮助文档集成', 12, NULL, '{"step_guide": 1.2, "tooltip": 1.05, "help_center": 1.3}'),
('版本升级/灰度发布', '其他', '系统版本管理、灰度发布策略、强制升级提示', 16, NULL, '{"canary_release": 1.3, "feature_flag": 1.25, "force_update": 1.1}');

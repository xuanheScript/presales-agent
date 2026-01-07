// 项目状态选项
export const PROJECT_STATUS = {
  DRAFT: 'draft',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
} as const

// 难度等级
export const DIFFICULTY_LEVELS = {
  SIMPLE: 'simple',
  MEDIUM: 'medium',
  COMPLEX: 'complex',
  VERY_COMPLEX: 'very_complex',
} as const

// 难度等级对应的工时倍数
export const DIFFICULTY_MULTIPLIERS = {
  simple: 1.0,
  medium: 1.5,
  complex: 2.5,
  very_complex: 4.0,
} as const

// 模板类型
export const TEMPLATE_TYPES = {
  REQUIREMENT_ANALYSIS: 'requirement_analysis',
  FUNCTION_BREAKDOWN: 'function_breakdown',
  EFFORT_ESTIMATION: 'effort_estimation',
  COST_CALCULATION: 'cost_calculation',
} as const

// 默认配置
export const DEFAULT_CONFIG = {
  LABOR_COST_PER_DAY: 1500, // 人天成本（元）
  RISK_BUFFER_PERCENTAGE: 15, // 风险缓冲百分比
  CURRENCY: 'CNY',
  WORKING_HOURS_PER_DAY: 8,
} as const

// 行业选项
export const INDUSTRIES = [
  '电商',
  '金融',
  '教育',
  '医疗',
  '物流',
  '制造业',
  '零售',
  '媒体',
  '政务',
  '其他',
] as const

// 技术栈选项
export const TECH_STACKS = [
  'React',
  'Vue',
  'Angular',
  'Next.js',
  'Node.js',
  'Python',
  'Java',
  'Go',
  '.NET',
  'PHP',
  'React Native',
  'Flutter',
  'iOS',
  'Android',
] as const

// 功能分类
export const FUNCTION_CATEGORIES = [
  '用户管理',
  '权限系统',
  '订单管理',
  '支付系统',
  '内容管理',
  '数据分析',
  '通知系统',
  '搜索功能',
  '文件管理',
  '报表系统',
  '工作流',
  '集成接口',
  '其他',
] as const

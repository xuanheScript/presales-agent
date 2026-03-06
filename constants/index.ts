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

/**
 * @deprecated AI 评估工时时已考虑难度因素，不再需要二次加权
 * 保留此常量仅用于向后兼容
 */
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
  /**
   * @deprecated AI 现在使用 bufferCoefficient (1.2-2.0x) 动态评估缓冲
   * 保留此字段仅用于向后兼容
   */
  RISK_BUFFER_PERCENTAGE: 15, // 风险缓冲百分比（已废弃）
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

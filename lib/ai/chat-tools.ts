import { tool } from 'ai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { DIFFICULTY_MULTIPLIERS } from '@/constants'
import type { ParsedRequirement, DifficultyLevel } from '@/types'

/**
 * 需求澄清对话工具集
 *
 * 提供给 AI Agent 在对话过程中保存和修改数据的能力
 * 使用工厂函数模式，为每个请求创建带有正确上下文的工具
 */

interface ChatToolsContext {
  projectId: string
  requirementId: string
}

/**
 * 创建带有上下文的聊天工具集
 */
export function createChatTools(context: ChatToolsContext) {
  const { projectId, requirementId } = context

  // ==================== 需求管理工具 ====================

  const updateRequirement = tool({
    description: '更新项目的原始需求文本内容。当用户提供了新的需求描述或想要修改现有需求时使用此工具。',
    inputSchema: z.object({
      content: z.string().describe('新的需求内容文本'),
    }),
    execute: async ({ content }) => {
      const supabase = await createClient()

      const { error } = await supabase
        .from('requirements')
        .update({ raw_content: content.trim() })
        .eq('id', requirementId)

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, message: '需求内容已更新' }
    },
  })

  const appendRequirement = tool({
    description: '在现有需求内容后追加新内容，不覆盖原有内容。当用户补充新的需求细节时使用。',
    inputSchema: z.object({
      content: z.string().describe('要追加的需求内容'),
    }),
    execute: async ({ content }) => {
      const supabase = await createClient()

      // 先获取现有内容
      const { data: requirement } = await supabase
        .from('requirements')
        .select('raw_content')
        .eq('id', requirementId)
        .single()

      const existingContent = requirement?.raw_content || ''
      const newContent = existingContent + '\n\n---\n\n' + content.trim()

      const { error } = await supabase
        .from('requirements')
        .update({ raw_content: newContent })
        .eq('id', requirementId)

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, message: '需求内容已追加' }
    },
  })

  const updateParsedRequirement = tool({
    description: '更新需求的结构化分析结果，包括项目类型、业务目标、核心功能、技术栈、非功能性需求和风险点。',
    inputSchema: z.object({
      projectType: z.string().optional().describe('项目类型，如：Web应用、移动应用、企业系统等'),
      businessGoals: z.array(z.string()).optional().describe('业务目标列表'),
      keyFeatures: z.array(z.string()).optional().describe('核心功能列表'),
      techStack: z.array(z.string()).optional().describe('技术栈列表'),
      nonFunctionalRequirements: z.object({
        performance: z.string().optional().describe('性能要求'),
        security: z.string().optional().describe('安全要求'),
        scalability: z.string().optional().describe('可扩展性要求'),
      }).optional().describe('非功能性需求'),
      risks: z.array(z.string()).optional().describe('风险点列表'),
    }),
    execute: async (params) => {
      const supabase = await createClient()

      // 获取现有的解析内容
      const { data: requirement } = await supabase
        .from('requirements')
        .select('parsed_content')
        .eq('id', requirementId)
        .single()

      const existingParsed = (requirement?.parsed_content || {}) as ParsedRequirement

      // 合并更新
      const updatedParsed: ParsedRequirement = {
        projectType: params.projectType ?? existingParsed.projectType ?? '',
        businessGoals: params.businessGoals ?? existingParsed.businessGoals ?? [],
        keyFeatures: params.keyFeatures ?? existingParsed.keyFeatures ?? [],
        techStack: params.techStack ?? existingParsed.techStack ?? [],
        nonFunctionalRequirements: {
          ...existingParsed.nonFunctionalRequirements,
          ...params.nonFunctionalRequirements,
        },
        risks: params.risks ?? existingParsed.risks ?? [],
      }

      const { error } = await supabase
        .from('requirements')
        .update({ parsed_content: updatedParsed })
        .eq('id', requirementId)

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, message: '需求分析结果已更新', data: updatedParsed }
    },
  })

  // ==================== 功能模块工具 ====================

  const addFunctionModule = tool({
    description: '添加新的功能模块到项目中。用于将用户确认的功能点添加到估算列表。',
    inputSchema: z.object({
      moduleName: z.string().describe('模块名称，如：用户管理、订单系统'),
      functionName: z.string().describe('功能名称，如：用户登录、订单创建'),
      description: z.string().optional().describe('功能描述'),
      difficultyLevel: z.enum(['simple', 'medium', 'complex', 'very_complex']).describe('难度级别：simple(简单)、medium(中等)、complex(复杂)、very_complex(非常复杂)'),
      estimatedHours: z.number().describe('预估工时（小时）'),
    }),
    execute: async ({ moduleName, functionName, description, difficultyLevel, estimatedHours }) => {
      const supabase = await createClient()

      const { data, error } = await supabase
        .from('function_modules')
        .insert({
          project_id: projectId,
          module_name: moduleName.trim(),
          function_name: functionName.trim(),
          description: description?.trim() || null,
          difficulty_level: difficultyLevel,
          estimated_hours: estimatedHours,
        })
        .select()
        .single()

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, message: `功能模块 "${functionName}" 已添加`, data }
    },
  })

  const addFunctionModulesBatch = tool({
    description: '批量添加多个功能模块到项目中。当需要一次性添加多个功能时使用。',
    inputSchema: z.object({
      modules: z.array(z.object({
        moduleName: z.string().describe('模块名称'),
        functionName: z.string().describe('功能名称'),
        description: z.string().optional().describe('功能描述'),
        difficultyLevel: z.enum(['simple', 'medium', 'complex', 'very_complex']).describe('难度级别'),
        estimatedHours: z.number().describe('预估工时（小时）'),
      })).describe('要添加的功能模块列表'),
    }),
    execute: async ({ modules }) => {
      const supabase = await createClient()

      const insertData = modules.map(m => ({
        project_id: projectId,
        module_name: m.moduleName.trim(),
        function_name: m.functionName.trim(),
        description: m.description?.trim() || null,
        difficulty_level: m.difficultyLevel,
        estimated_hours: m.estimatedHours,
      }))

      const { data, error } = await supabase
        .from('function_modules')
        .insert(insertData)
        .select()

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, message: `已添加 ${modules.length} 个功能模块`, data }
    },
  })

  const updateFunctionHours = tool({
    description: '更新指定功能模块的预估工时。',
    inputSchema: z.object({
      functionId: z.string().describe('功能模块ID'),
      hours: z.number().describe('新的预估工时（小时）'),
    }),
    execute: async ({ functionId, hours }) => {
      const supabase = await createClient()

      const { data, error } = await supabase
        .from('function_modules')
        .update({ estimated_hours: hours })
        .eq('id', functionId)
        .eq('project_id', projectId)
        .select()
        .single()

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, message: `工时已更新为 ${hours} 小时`, data }
    },
  })

  const updateFunctionDifficulty = tool({
    description: '更新指定功能模块的难度级别。',
    inputSchema: z.object({
      functionId: z.string().describe('功能模块ID'),
      difficultyLevel: z.enum(['simple', 'medium', 'complex', 'very_complex']).describe('新的难度级别'),
    }),
    execute: async ({ functionId, difficultyLevel }) => {
      const supabase = await createClient()

      const { data, error } = await supabase
        .from('function_modules')
        .update({ difficulty_level: difficultyLevel })
        .eq('id', functionId)
        .eq('project_id', projectId)
        .select()
        .single()

      if (error) {
        return { success: false, error: error.message }
      }

      const difficultyLabels: Record<string, string> = {
        simple: '简单',
        medium: '中等',
        complex: '复杂',
        very_complex: '非常复杂',
      }

      return { success: true, message: `难度已更新为 ${difficultyLabels[difficultyLevel]}`, data }
    },
  })

  const deleteFunctionModule = tool({
    description: '删除指定的功能模块。当用户决定移除某个功能时使用。',
    inputSchema: z.object({
      functionId: z.string().describe('要删除的功能模块ID'),
    }),
    execute: async ({ functionId }) => {
      const supabase = await createClient()

      // 先获取功能名称用于返回消息
      const { data: fn } = await supabase
        .from('function_modules')
        .select('function_name')
        .eq('id', functionId)
        .eq('project_id', projectId)
        .single()

      const { error } = await supabase
        .from('function_modules')
        .delete()
        .eq('id', functionId)
        .eq('project_id', projectId)

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, message: `功能模块 "${fn?.function_name || functionId}" 已删除` }
    },
  })

  const addFromLibrary = tool({
    description: '从标准功能库中添加功能到项目。可以使用功能库中的标准工时或自定义工时。',
    inputSchema: z.object({
      libraryItemId: z.string().describe('功能库项目ID'),
      customHours: z.number().optional().describe('自定义工时（可选，不填则使用标准工时）'),
      customDifficulty: z.enum(['simple', 'medium', 'complex', 'very_complex']).optional().describe('自定义难度（可选）'),
    }),
    execute: async ({ libraryItemId, customHours, customDifficulty }) => {
      const supabase = await createClient()

      // 获取功能库项目
      const { data: libraryItem } = await supabase
        .from('function_library')
        .select('*')
        .eq('id', libraryItemId)
        .single()

      if (!libraryItem) {
        return { success: false, error: '功能库项目不存在' }
      }

      // 添加到项目
      const { data, error } = await supabase
        .from('function_modules')
        .insert({
          project_id: projectId,
          module_name: libraryItem.category,
          function_name: libraryItem.function_name,
          description: libraryItem.description,
          difficulty_level: customDifficulty || 'medium',
          estimated_hours: customHours ?? libraryItem.standard_hours,
        })
        .select()
        .single()

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, message: `已从功能库添加 "${libraryItem.function_name}"`, data }
    },
  })

  // ==================== 成本估算工具 ====================

  const updateCostParameters = tool({
    description: '更新成本估算的计算参数，如风险缓冲比例、服务成本、基础设施成本等。',
    inputSchema: z.object({
      bufferPercentage: z.number().optional().describe('风险缓冲比例（%），如 15 表示 15%'),
      serviceCost: z.number().optional().describe('第三方服务成本（元）'),
      infrastructureCost: z.number().optional().describe('基础设施成本（元）'),
    }),
    execute: async (params) => {
      const supabase = await createClient()

      // 获取现有成本估算
      const { data: existingCost } = await supabase
        .from('cost_estimates')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const updateData: Record<string, number> = {}

      if (params.serviceCost !== undefined) {
        updateData.service_cost = params.serviceCost
      }
      if (params.infrastructureCost !== undefined) {
        updateData.infrastructure_cost = params.infrastructureCost
      }
      if (params.bufferPercentage !== undefined) {
        updateData.buffer_percentage = params.bufferPercentage
      }

      if (existingCost) {
        // 更新现有记录
        const { error } = await supabase
          .from('cost_estimates')
          .update(updateData)
          .eq('id', existingCost.id)

        if (error) {
          return { success: false, error: error.message }
        }
      } else {
        // 创建新记录
        const { error } = await supabase
          .from('cost_estimates')
          .insert({
            project_id: projectId,
            labor_cost: 0,
            service_cost: params.serviceCost || 0,
            infrastructure_cost: params.infrastructureCost || 0,
            buffer_percentage: params.bufferPercentage || 15,
            total_cost: 0,
            breakdown: {},
          })

        if (error) {
          return { success: false, error: error.message }
        }
      }

      return { success: true, message: '成本参数已更新' }
    },
  })

  const recalculateCost = tool({
    description: '基于当前的功能模块列表重新计算项目总成本。在添加或修改功能后调用此工具更新成本。使用加权工时计算（根据难度级别应用不同倍数）。可选参数允许用户自定义成本配置，未指定时从系统配置读取。',
    inputSchema: z.object({
      laborCostPerDay: z.number().optional().describe('人天成本（元），不指定则使用系统配置'),
      riskBufferPercentage: z.number().optional().describe('风险缓冲比例（%），不指定则使用系统配置'),
      serviceCost: z.number().optional().describe('第三方服务成本（元），不指定则使用现有值'),
      infrastructureCost: z.number().optional().describe('基础设施成本（元），不指定则使用现有值'),
    }),
    execute: async (params) => {
      const supabase = await createClient()

      // 获取所有功能模块
      const { data: functions } = await supabase
        .from('function_modules')
        .select('estimated_hours, difficulty_level')
        .eq('project_id', projectId)

      if (!functions || functions.length === 0) {
        return { success: false, error: '没有功能模块，无法计算成本' }
      }

      // 获取系统配置（仅当用户未指定参数时使用）
      const { data: config } = await supabase
        .from('system_config')
        .select('*')
        .limit(1)
        .single()

      // 获取现有成本估算
      const { data: existingCost } = await supabase
        .from('cost_estimates')
        .select('service_cost, infrastructure_cost, buffer_percentage, breakdown')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      // 确定最终使用的配置值（优先级：用户指定 > 现有值 > 系统配置 > 默认值）
      const laborCostPerDay = params.laborCostPerDay
        ?? config?.default_labor_cost_per_day
        ?? 1500
      const bufferPercentage = params.riskBufferPercentage
        ?? existingCost?.buffer_percentage
        ?? config?.default_risk_buffer_percentage
        ?? 15
      const serviceCost = params.serviceCost
        ?? existingCost?.service_cost
        ?? 0
      const infrastructureCost = params.infrastructureCost
        ?? existingCost?.infrastructure_cost
        ?? 0
      const workingHoursPerDay = 8

      // 计算基础工时和加权工时（与 workflow 计算逻辑一致）
      // 难度倍数：simple=1.0, medium=1.5, complex=2.5, very_complex=4.0
      let baseHours = 0
      let weightedHours = 0
      for (const fn of functions) {
        const hours = Number(fn.estimated_hours)
        baseHours += hours
        const multiplier = DIFFICULTY_MULTIPLIERS[fn.difficulty_level as DifficultyLevel] || 1
        weightedHours += hours * multiplier
      }

      // 使用加权工时计算人天数
      const totalDays = Math.round((weightedHours / workingHoursPerDay) * 10) / 10

      // 计算人力成本
      const laborCost = Math.round(totalDays * laborCostPerDay)

      // 计算总成本（含缓冲）
      const baseCost = laborCost + serviceCost + infrastructureCost
      const buffer = Math.round(baseCost * (bufferPercentage / 100))
      const totalCost = baseCost + buffer

      // 更新或创建成本估算
      const costData = {
        project_id: projectId,
        labor_cost: laborCost,
        service_cost: serviceCost,
        infrastructure_cost: infrastructureCost,
        buffer_percentage: bufferPercentage,
        total_cost: totalCost,
        breakdown: {
          baseHours,
          weightedHours: Math.round(weightedHours * 10) / 10,
          totalDays,
          laborCostPerDay,
          buffer,
        },
      }

      if (existingCost) {
        await supabase
          .from('cost_estimates')
          .update(costData)
          .eq('project_id', projectId)
      } else {
        await supabase
          .from('cost_estimates')
          .insert(costData)
      }

      return {
        success: true,
        message: '成本已重新计算',
        data: {
          baseHours,
          weightedHours: Math.round(weightedHours * 10) / 10,
          totalDays,
          laborCostPerDay,
          laborCost,
          serviceCost,
          infrastructureCost,
          bufferPercentage,
          buffer,
          totalCost,
        },
      }
    },
  })

  // ==================== 项目信息工具 ====================

  const updateProjectDescription = tool({
    description: '更新项目的描述信息。',
    inputSchema: z.object({
      description: z.string().describe('新的项目描述'),
    }),
    execute: async ({ description }) => {
      const supabase = await createClient()

      const { error } = await supabase
        .from('projects')
        .update({ description: description.trim() })
        .eq('id', projectId)

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, message: '项目描述已更新' }
    },
  })

  const updateProjectIndustry = tool({
    description: '更新项目所属行业。',
    inputSchema: z.object({
      industry: z.string().describe('行业名称，如：金融、电商、教育、医疗、制造等'),
    }),
    execute: async ({ industry }) => {
      const supabase = await createClient()

      const { error } = await supabase
        .from('projects')
        .update({ industry: industry.trim() })
        .eq('id', projectId)

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, message: `项目行业已更新为 "${industry}"` }
    },
  })

  // ==================== 查询工具 ====================

  const getFunctionModules = tool({
    description: '获取当前项目的所有功能模块列表。用于查看当前已添加的功能和工时。',
    inputSchema: z.object({}),
    execute: async () => {
      const supabase = await createClient()

      const { data, error } = await supabase
        .from('function_modules')
        .select('*')
        .eq('project_id', projectId)
        .order('module_name', { ascending: true })
        .order('function_name', { ascending: true })

      if (error) {
        return { success: false, error: error.message }
      }

      const totalHours = data?.reduce((sum, f) => sum + Number(f.estimated_hours), 0) || 0

      return {
        success: true,
        data: {
          modules: data || [],
          count: data?.length || 0,
          totalHours,
        },
      }
    },
  })

  const getCostSummary = tool({
    description: '获取当前项目的成本估算汇总信息。',
    inputSchema: z.object({}),
    execute: async () => {
      const supabase = await createClient()

      const { data: cost } = await supabase
        .from('cost_estimates')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!cost) {
        return { success: true, data: null, message: '暂无成本估算数据' }
      }

      return {
        success: true,
        data: {
          laborCost: cost.labor_cost,
          serviceCost: cost.service_cost,
          infrastructureCost: cost.infrastructure_cost,
          bufferPercentage: cost.buffer_percentage,
          totalCost: cost.total_cost,
          breakdown: cost.breakdown,
        },
      }
    },
  })

  const searchFunctionLibrary = tool({
    description: '搜索标准功能库，查找可复用的功能模块及其标准工时。帮助用户找到已有的标准功能估算。',
    inputSchema: z.object({
      keyword: z.string().describe('搜索关键词'),
      category: z.string().optional().describe('功能分类（可选）'),
    }),
    execute: async ({ keyword, category }) => {
      const supabase = await createClient()

      let query = supabase
        .from('function_library')
        .select('*')
        .ilike('function_name', `%${keyword}%`)
        .order('category', { ascending: true })
        .limit(10)

      if (category) {
        query = query.eq('category', category)
      }

      const { data, error } = await query

      if (error) {
        return { success: false, error: error.message }
      }

      return {
        success: true,
        data: data || [],
        count: data?.length || 0,
      }
    },
  })

  const getProjectSummary = tool({
    description: '获取项目的整体汇总信息，包括功能模块数、总工时、成本等。用于给用户展示项目全貌。',
    inputSchema: z.object({}),
    execute: async () => {
      const supabase = await createClient()

      // 获取项目基本信息
      const { data: project } = await supabase
        .from('projects')
        .select('name, description, industry, status')
        .eq('id', projectId)
        .single()

      // 获取功能模块统计
      const { data: functions } = await supabase
        .from('function_modules')
        .select('estimated_hours, difficulty_level')
        .eq('project_id', projectId)

      // 获取成本估算
      const { data: cost } = await supabase
        .from('cost_estimates')
        .select('total_cost, labor_cost, buffer_percentage')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      // 计算难度分布
      const byDifficulty: Record<DifficultyLevel, number> = {
        simple: 0,
        medium: 0,
        complex: 0,
        very_complex: 0,
      }

      let totalHours = 0
      functions?.forEach(f => {
        totalHours += Number(f.estimated_hours)
        byDifficulty[f.difficulty_level as DifficultyLevel]++
      })

      return {
        success: true,
        data: {
          project: project || null,
          totalModules: functions?.length || 0,
          totalHours,
          totalDays: Math.round((totalHours / 8) * 10) / 10,
          byDifficulty,
          totalCost: cost?.total_cost || 0,
          laborCost: cost?.labor_cost || 0,
          bufferPercentage: cost?.buffer_percentage || 15,
        },
      }
    },
  })

  const getSystemConfig = tool({
    description: '获取系统成本配置信息，包括人天成本、默认风险缓冲比例、货币单位等。这是成本估算的核心配置数据源，在进行成本计算或向用户解释成本时应先调用此工具获取最新配置。',
    inputSchema: z.object({}),
    execute: async () => {
      const supabase = await createClient()

      const { data: config, error } = await supabase
        .from('system_config')
        .select('*')
        .limit(1)
        .single()

      // 默认配置
      const defaultConfig = {
        laborCostPerDay: 1500,
        riskBufferPercentage: 15,
        currency: 'CNY',
        workingHoursPerDay: 8,
      }

      if (error || !config) {
        return {
          success: true,
          message: '使用默认配置',
          data: defaultConfig,
        }
      }

      return {
        success: true,
        data: {
          laborCostPerDay: config.default_labor_cost_per_day || defaultConfig.laborCostPerDay,
          riskBufferPercentage: config.default_risk_buffer_percentage || defaultConfig.riskBufferPercentage,
          currency: config.currency || defaultConfig.currency,
          workingHoursPerDay: defaultConfig.workingHoursPerDay,
        },
      }
    },
  })

  // 返回所有工具
  return {
    // 需求管理
    updateRequirement,
    appendRequirement,
    updateParsedRequirement,

    // 功能模块
    addFunctionModule,
    addFunctionModulesBatch,
    updateFunctionHours,
    updateFunctionDifficulty,
    deleteFunctionModule,
    addFromLibrary,

    // 成本估算
    updateCostParameters,
    recalculateCost,

    // 项目信息
    updateProjectDescription,
    updateProjectIndustry,

    // 查询工具
    getFunctionModules,
    getCostSummary,
    searchFunctionLibrary,
    getProjectSummary,
    getSystemConfig,
  }
}

export type ChatTools = ReturnType<typeof createChatTools>
export type ChatToolName = keyof ChatTools

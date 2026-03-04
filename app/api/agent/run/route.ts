import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runPresalesWorkflow } from '@/lib/agents/graph'
import { getRequirement, updateRequirementAnalysis } from '@/app/actions/requirements'
import { getSystemConfig } from '@/app/actions/settings'
import { DEFAULT_CONFIG } from '@/constants'
import type { ParsedRequirement } from '@/types'
import type { WorkflowSystemConfig } from '@/lib/agents/state'

export const maxDuration = 300 // 允许最长 300 秒执行

interface RunRequest {
  projectId: string
  requirementId: string
}

/**
 * POST /api/agent/run
 *
 * 执行售前成本估算 Agent 工作流
 */
export async function POST(req: Request) {
  try {
    const { projectId, requirementId }: RunRequest = await req.json()

    // 验证参数
    if (!projectId || !requirementId) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      )
    }

    // 获取需求内容
    const requirement = await getRequirement(requirementId)
    if (!requirement) {
      return NextResponse.json(
        { error: '需求不存在或无权限访问' },
        { status: 404 }
      )
    }

    // 验证需求内容不为空
    if (!requirement.raw_content || requirement.raw_content.trim() === '') {
      return NextResponse.json(
        { error: '需求内容为空' },
        { status: 400 }
      )
    }

    // 获取项目信息（包含项目描述）
    const supabase = await createClient()
    const { data: project } = await supabase
      .from('projects')
      .select('description')
      .eq('id', projectId)
      .single()

    // 获取系统配置
    const dbConfig = await getSystemConfig()
    const systemConfig: WorkflowSystemConfig = {
      laborCostPerDay: dbConfig?.default_labor_cost_per_day || DEFAULT_CONFIG.LABOR_COST_PER_DAY,
      riskBufferPercentage: dbConfig?.default_risk_buffer_percentage || DEFAULT_CONFIG.RISK_BUFFER_PERCENTAGE,
      workingHoursPerDay: DEFAULT_CONFIG.WORKING_HOURS_PER_DAY,
    }

    // 更新项目状态为分析中
    await supabase
      .from('projects')
      .update({ status: 'analyzing' })
      .eq('id', projectId)

    // 执行工作流
    const result = await runPresalesWorkflow(
      projectId,
      requirementId,
      requirement.raw_content,
      project?.description || '',
      systemConfig
    )

    // 如果工作流执行失败
    if (!result.success || result.error) {
      // 回滚项目状态
      await supabase
        .from('projects')
        .update({ status: 'draft' })
        .eq('id', projectId)

      return NextResponse.json(
        { error: result.error || '工作流执行失败' },
        { status: 500 }
      )
    }

    // 保存分析结果到数据库
    if (result.analysis) {
      // 转换为 ParsedRequirement 格式
      const parsedContent: ParsedRequirement = {
        projectType: result.analysis.projectType,
        businessGoals: result.analysis.businessGoals,
        keyFeatures: result.analysis.keyFeatures,
        techStack: result.analysis.techStack,
        nonFunctionalRequirements: result.analysis.nonFunctionalRequirements,
        risks: result.analysis.risks,
      }

      await updateRequirementAnalysis(requirementId, parsedContent)
    }

    // 保存功能模块
    if (result.functions && result.functions.length > 0) {
      // 先删除旧的功能模块
      await supabase
        .from('function_modules')
        .delete()
        .eq('project_id', projectId)

      // 插入新的功能模块（新版本：包含按角色评估的工时）
      const functionModules = result.functions.map((fn) => ({
        project_id: projectId,
        module_name: fn.moduleName,
        function_name: fn.functionName,
        description: fn.description,
        difficulty_level: fn.difficultyLevel,
        // 计算总工时（所有角色工时之和）
        estimated_hours: fn.roleEstimates.reduce((sum, r) => sum + r.days * 8, 0),
        // 将角色工时详情存入 dependencies 字段（临时方案，后续需要更新数据库 schema）
        dependencies: fn.dependencies || null,
        // 新增：角色工时详情（需要数据库添加 role_estimates JSONB 字段）
        role_estimates: fn.roleEstimates,
      }))

      await supabase.from('function_modules').insert(functionModules)
    }

    // 保存识别的项目角色
    if (result.identifiedRoles && result.identifiedRoles.length > 0) {
      // 先删除旧的角色
      await supabase
        .from('project_roles')
        .delete()
        .eq('project_id', projectId)

      // 从 estimation.roleSummary 获取各角色的汇总工时
      const roleSummaryMap = new Map(
        result.estimation?.roleSummary?.map((r) => [r.role, r.totalDays]) || []
      )

      // 插入新的角色
      const projectRoles = result.identifiedRoles.map((role) => ({
        project_id: projectId,
        role_name: role.role,
        responsibility: role.responsibility,
        headcount: role.headcount,
        total_days: roleSummaryMap.get(role.role) || 0,
      }))

      await supabase.from('project_roles').insert(projectRoles)
    }

    // 保存额外工作项
    if (result.additionalWork && result.additionalWork.length > 0) {
      // 先删除旧的额外工作项
      await supabase
        .from('additional_work_items')
        .delete()
        .eq('project_id', projectId)

      // 插入新的额外工作项
      const additionalWorkItems = result.additionalWork.map((work) => ({
        project_id: projectId,
        work_item: work.workItem,
        days: work.days,
        assigned_roles: work.assignedRoles,
      }))

      await supabase.from('additional_work_items').insert(additionalWorkItems)
    }

    // 保存成本估算（新版本：包含按角色汇总的成本）
    if (result.cost) {
      // 先删除旧的成本估算
      await supabase
        .from('cost_estimates')
        .delete()
        .eq('project_id', projectId)

      // 插入新的成本估算
      await supabase.from('cost_estimates').insert({
        project_id: projectId,
        labor_cost: result.cost.laborCost,
        service_cost: result.cost.serviceCost,
        infrastructure_cost: result.cost.infrastructureCost,
        // 使用缓冲系数转换为百分比存储（例如 1.3 -> 30%）
        buffer_percentage: (result.cost.bufferCoefficient - 1) * 100,
        total_cost: result.cost.totalCost,
        // 新字段
        base_days: result.cost.baseDays,
        buffered_days: result.cost.bufferedDays,
        buffer_coefficient: result.cost.bufferCoefficient,
        // breakdown 包含角色明细
        breakdown: {
          role_breakdown: result.cost.roleBreakdown,
          additional_work_breakdown: result.cost.additionalWorkBreakdown,
          third_party_services: result.cost.thirdPartyServices,
        },
      })
    }

    // 更新项目状态为已完成
    await supabase
      .from('projects')
      .update({ status: 'completed' })
      .eq('id', projectId)

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('[API] Agent 执行失败:', error)

    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器内部错误' },
      { status: 500 }
    )
  }
}

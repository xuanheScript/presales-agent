import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runPresalesWorkflow } from '@/lib/agents/graph'
import { getRequirement, updateRequirementAnalysis } from '@/app/actions/requirements'
import type { ParsedRequirement } from '@/types'

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

    // 更新项目状态为分析中
    const supabase = await createClient()
    await supabase
      .from('projects')
      .update({ status: 'analyzing' })
      .eq('id', projectId)

    // 执行工作流
    const result = await runPresalesWorkflow(
      projectId,
      requirementId,
      requirement.raw_content
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

      // 插入新的功能模块
      const functionModules = result.functions.map((fn) => ({
        project_id: projectId,
        module_name: fn.moduleName,
        function_name: fn.functionName,
        description: fn.description,
        difficulty_level: fn.difficultyLevel,
        estimated_hours: fn.estimatedHours,
        dependencies: fn.dependencies || null,
      }))

      await supabase.from('function_modules').insert(functionModules)
    }

    // 保存成本估算
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
        buffer_percentage: result.cost.bufferPercentage,
        total_cost: result.cost.totalCost,
        breakdown: result.cost.breakdown,
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

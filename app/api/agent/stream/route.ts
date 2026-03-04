import { createClient } from '@/lib/supabase/server'
import { streamPresalesWorkflow } from '@/lib/agents/graph'
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
 * POST /api/agent/stream
 *
 * 流式执行售前成本估算 Agent 工作流
 * 使用 Server-Sent Events (SSE) 推送实时进度
 */
export async function POST(req: Request) {
  try {
    const { projectId, requirementId }: RunRequest = await req.json()

    // 验证参数
    if (!projectId || !requirementId) {
      return new Response(
        JSON.stringify({ error: '缺少必要参数' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 获取需求内容
    const requirement = await getRequirement(requirementId)
    if (!requirement) {
      return new Response(
        JSON.stringify({ error: '需求不存在或无权限访问' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 验证需求内容不为空
    if (!requirement.raw_content || requirement.raw_content.trim() === '') {
      return new Response(
        JSON.stringify({ error: '需求内容为空' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 更新项目状态为分析中
    const supabase = await createClient()
    await supabase
      .from('projects')
      .update({ status: 'analyzing' })
      .eq('id', projectId)

    // 获取系统配置
    const dbConfig = await getSystemConfig()
    const systemConfig: WorkflowSystemConfig = {
      laborCostPerDay: dbConfig?.default_labor_cost_per_day || DEFAULT_CONFIG.LABOR_COST_PER_DAY,
      riskBufferPercentage: dbConfig?.default_risk_buffer_percentage || DEFAULT_CONFIG.RISK_BUFFER_PERCENTAGE,
      workingHoursPerDay: DEFAULT_CONFIG.WORKING_HOURS_PER_DAY,
    }

    // 创建 SSE 流
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        }

        try {
          let lastResult: {
            analysis?: unknown
            functions?: unknown[]
            identifiedRoles?: unknown[]
            additionalWork?: unknown[]
            estimation?: unknown
            cost?: unknown
          } = {}

          // 流式执行工作流
          for await (const update of streamPresalesWorkflow(
            projectId,
            requirementId,
            requirement.raw_content,
            '', // projectDescription
            systemConfig
          )) {
            console.log('[Stream] 步骤更新:', update.step)

            // 发送进度事件
            sendEvent('progress', {
              step: update.step,
              isComplete: update.state.isComplete,
              error: update.state.error,
            })

            // 保存最新状态
            if (update.state.analysis) lastResult.analysis = update.state.analysis
            if (update.state.functions) lastResult.functions = update.state.functions
            if (update.state.identifiedRoles) lastResult.identifiedRoles = update.state.identifiedRoles
            if (update.state.additionalWork) lastResult.additionalWork = update.state.additionalWork
            if (update.state.estimation) lastResult.estimation = update.state.estimation
            if (update.state.cost) lastResult.cost = update.state.cost

            // 如果有错误，终止
            if (update.state.error) {
              sendEvent('error', { error: update.state.error })

              // 回滚项目状态
              await supabase
                .from('projects')
                .update({ status: 'draft' })
                .eq('id', projectId)

              controller.close()
              return
            }
          }

          // 保存结果到数据库
          if (lastResult.analysis) {
            const analysis = lastResult.analysis as {
              projectType?: string
              businessGoals?: string[]
              keyFeatures?: string[]
              techStack?: string[]
              nonFunctionalRequirements?: {
                performance?: string
                security?: string
                scalability?: string
              }
              risks?: string[]
            }

            const parsedContent: ParsedRequirement = {
              projectType: analysis.projectType || '未知类型',
              businessGoals: analysis.businessGoals || [],
              keyFeatures: analysis.keyFeatures || [],
              techStack: analysis.techStack || [],
              nonFunctionalRequirements: analysis.nonFunctionalRequirements || {},
              risks: analysis.risks || [],
            }

            await updateRequirementAnalysis(requirementId, parsedContent)
          }

          // 保存功能模块（新版本：包含按角色评估的工时）
          if (lastResult.functions && (lastResult.functions as unknown[]).length > 0) {
            await supabase
              .from('function_modules')
              .delete()
              .eq('project_id', projectId)

            const functionModules = (lastResult.functions as Array<{
              moduleName: string
              functionName: string
              description: string
              difficultyLevel: string
              roleEstimates: Array<{ role: string; days: number; reason?: string }>
              dependencies?: string[]
            }>).map((fn) => ({
              project_id: projectId,
              module_name: fn.moduleName,
              function_name: fn.functionName,
              description: fn.description,
              difficulty_level: fn.difficultyLevel,
              // 计算总工时（所有角色工时之和，转换为小时）
              estimated_hours: fn.roleEstimates.reduce((sum, r) => sum + r.days * 8, 0),
              dependencies: fn.dependencies || null,
              // 新增：角色工时详情
              role_estimates: fn.roleEstimates,
            }))

            await supabase.from('function_modules').insert(functionModules)
          }

          // 保存识别的项目角色
          if (lastResult.identifiedRoles && (lastResult.identifiedRoles as unknown[]).length > 0) {
            await supabase
              .from('project_roles')
              .delete()
              .eq('project_id', projectId)

            // 从 estimation.roleSummary 获取各角色的汇总工时
            const estimation = lastResult.estimation as {
              roleSummary?: Array<{ role: string; totalDays: number }>
            } | undefined
            const roleSummaryMap = new Map(
              estimation?.roleSummary?.map((r) => [r.role, r.totalDays]) || []
            )

            const projectRoles = (lastResult.identifiedRoles as Array<{
              role: string
              responsibility: string
              headcount: number
            }>).map((role) => ({
              project_id: projectId,
              role_name: role.role,
              responsibility: role.responsibility,
              headcount: role.headcount,
              total_days: roleSummaryMap.get(role.role) || 0,
            }))

            await supabase.from('project_roles').insert(projectRoles)
          }

          // 保存额外工作项
          if (lastResult.additionalWork && (lastResult.additionalWork as unknown[]).length > 0) {
            await supabase
              .from('additional_work_items')
              .delete()
              .eq('project_id', projectId)

            const additionalWorkItems = (lastResult.additionalWork as Array<{
              workItem: string
              days: number
              assignedRoles: string[]
            }>).map((work) => ({
              project_id: projectId,
              work_item: work.workItem,
              days: work.days,
              assigned_roles: work.assignedRoles,
            }))

            await supabase.from('additional_work_items').insert(additionalWorkItems)
          }

          // 保存成本估算（新版本：包含按角色汇总的成本）
          if (lastResult.cost) {
            const cost = lastResult.cost as {
              laborCost: number
              serviceCost: number
              infrastructureCost: number
              bufferCoefficient: number
              totalCost: number
              baseDays: number
              bufferedDays: number
              roleBreakdown?: unknown
              additionalWorkBreakdown?: unknown
              thirdPartyServices?: unknown
            }

            await supabase
              .from('cost_estimates')
              .delete()
              .eq('project_id', projectId)

            await supabase.from('cost_estimates').insert({
              project_id: projectId,
              labor_cost: cost.laborCost,
              service_cost: cost.serviceCost,
              infrastructure_cost: cost.infrastructureCost,
              // 使用缓冲系数转换为百分比存储（例如 1.3 -> 30%）
              buffer_percentage: (cost.bufferCoefficient - 1) * 100,
              total_cost: cost.totalCost,
              // 新字段
              base_days: cost.baseDays,
              buffered_days: cost.bufferedDays,
              buffer_coefficient: cost.bufferCoefficient,
              // breakdown 包含角色明细（使用 camelCase 与前端类型一致）
              breakdown: {
                roleBreakdown: cost.roleBreakdown,
                additionalWorkBreakdown: cost.additionalWorkBreakdown,
                thirdPartyServices: cost.thirdPartyServices,
              },
            })
          }

          // 更新项目状态为已完成
          await supabase
            .from('projects')
            .update({ status: 'completed' })
            .eq('id', projectId)

          // 发送完成事件
          sendEvent('complete', {
            success: true,
            data: {
              analysis: lastResult.analysis,
              functions: lastResult.functions,
              estimation: lastResult.estimation,
              cost: lastResult.cost,
            },
          })

          controller.close()
        } catch (error) {
          console.error('[Stream] 工作流执行失败:', error)

          sendEvent('error', {
            error: error instanceof Error ? error.message : '工作流执行失败',
          })

          // 回滚项目状态
          await supabase
            .from('projects')
            .update({ status: 'draft' })
            .eq('id', projectId)

          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('[API] Agent 流式执行失败:', error)

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : '服务器内部错误' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

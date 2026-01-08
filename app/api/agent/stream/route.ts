import { createClient } from '@/lib/supabase/server'
import { streamPresalesWorkflow } from '@/lib/agents/graph'
import { getRequirement, updateRequirementAnalysis } from '@/app/actions/requirements'
import type { ParsedRequirement } from '@/types'

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
            estimation?: unknown
            cost?: unknown
          } = {}

          // 流式执行工作流
          for await (const update of streamPresalesWorkflow(
            projectId,
            requirementId,
            requirement.raw_content
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

          // 保存功能模块
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
              estimatedHours: number
              dependencies?: string[]
            }>).map((fn) => ({
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
          if (lastResult.cost) {
            const cost = lastResult.cost as {
              laborCost: number
              serviceCost: number
              infrastructureCost: number
              bufferPercentage: number
              totalCost: number
              breakdown: unknown
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
              buffer_percentage: cost.bufferPercentage,
              total_cost: cost.totalCost,
              breakdown: cost.breakdown,
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

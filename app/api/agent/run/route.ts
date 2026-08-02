import { NextResponse } from 'next/server'
import { tasks } from '@trigger.dev/sdk'
import type { generateEstimateTask } from '@/trigger/generate-estimate'
import { preparePresalesExecution, PresalesExecutionError } from '@/lib/agents/execution-service'

interface RunRequest {
  projectId: string
  requirementBaselineId: string
  requestId: string
}

export async function POST(req: Request) {
  try {
    const { projectId, requirementBaselineId, requestId }: RunRequest = await req.json()
    if (!requestId || requestId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(requestId)) {
      return NextResponse.json({ error: '缺少有效的请求幂等标识' }, { status: 400 })
    }
    const prepared = await preparePresalesExecution(projectId, requirementBaselineId)
    const handle = await tasks.trigger<typeof generateEstimateTask>(
      'generate-estimate',
      {
        actorUserId: prepared.userId,
        projectId: prepared.projectId,
        requirementBaselineId: prepared.requirementBaselineId,
      },
      {
        idempotencyKey: `generate-estimate:${prepared.userId}:${prepared.projectId}:${prepared.requirementBaselineId}:${requestId}`,
        idempotencyKeyTTL: '24h',
      }
    )

    return NextResponse.json(
      {
        accepted: true,
        backgroundRunId: handle.id,
      },
      { status: 202 }
    )
  } catch (error) {
    const status = error instanceof PresalesExecutionError ? error.status : 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '启动后台估算失败' },
      { status }
    )
  }
}

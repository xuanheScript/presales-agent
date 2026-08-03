import { NextResponse } from 'next/server'
import { runs } from '@trigger.dev/sdk'
import { z } from 'zod'
import type { generateEstimateTask } from '@/trigger/generate-estimate'
import { getProject } from '@/app/actions/projects'
import { getEstimateVersionSnapshot } from '@/app/actions/estimate-versions'
import { createClient } from '@/lib/supabase/server'

const querySchema = z.strictObject({
  projectId: z.uuid(),
})

const durableStages = new Set([
  'planning',
  'discovering',
  'enriching',
  'calculating',
  'committing',
  'complete',
])

function normalizeDurableStage(
  stage: string | null | undefined,
  progressPercent: number | null | undefined
) {
  if (stage && durableStages.has(stage)) return stage
  return (progressPercent ?? 0) > 0 ? 'discovering' : 'planning'
}

const terminalStatuses = new Set([
  'COMPLETED',
  'CANCELED',
  'FAILED',
  'CRASHED',
  'SYSTEM_FAILURE',
  'EXPIRED',
  'TIMED_OUT',
])

function parseQuery(request: Request) {
  return querySchema.safeParse({
    projectId: new URL(request.url).searchParams.get('projectId'),
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const query = parseQuery(request)
  if (!runId || !query.success) {
    return NextResponse.json({ error: '后台估算查询参数无效' }, { status: 400 })
  }

  try {
    const project = await getProject(query.data.projectId)
    if (!project) {
      return NextResponse.json({ error: '项目不存在或无权限' }, { status: 404 })
    }

    const supabase = await createClient()
    const { data: execution, error: executionError } = await supabase
      .from('agent_executions')
      .select('id, status, current_stage, progress_percent, last_heartbeat_at, lease_expires_at, estimate_version_id, error_message')
      .eq('orchestration_run_id', runId)
      .eq('project_id', query.data.projectId)
      .maybeSingle()
    if (executionError) throw new Error(executionError.message)

    let run: Awaited<ReturnType<typeof runs.retrieve<typeof generateEstimateTask>>> | null = null
    try {
      run = await runs.retrieve<typeof generateEstimateTask>(runId)
      if (
        run.payload?.actorUserId !== project.created_by
        || run.payload?.projectId !== query.data.projectId
      ) {
        return NextResponse.json({ error: '后台估算任务与项目不匹配' }, { status: 403 })
      }
    } catch (triggerError) {
      if (!execution) throw triggerError
    }
    const output = run?.status === 'COMPLETED' ? run.output : undefined
    const estimateVersionId = execution?.estimate_version_id || output?.estimateVersionId
    const snapshot = estimateVersionId
      ? await getEstimateVersionSnapshot(query.data.projectId, { versionId: estimateVersionId })
      : null

    const executionTerminal = execution
      ? execution.status !== 'running'
      : false
    return NextResponse.json({
      status: run?.status || 'UNKNOWN',
      platformStatus: run?.status || null,
      executionId: execution?.id || null,
      executionStatus: execution?.status || null,
      stage: normalizeDurableStage(execution?.current_stage, execution?.progress_percent),
      progressPercent: execution?.progress_percent || 0,
      lastHeartbeatAt: execution?.last_heartbeat_at || null,
      leaseExpiresAt: execution?.lease_expires_at || null,
      isTerminal: execution ? executionTerminal : (run ? terminalStatuses.has(run.status) : false),
      estimateVersionId: snapshot?.version.id || null,
      revision: snapshot?.version.revision_no || null,
      error: execution?.error_message || run?.error?.message,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '查询后台估算状态失败' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const query = parseQuery(request)
  if (!runId || !query.success) {
    return NextResponse.json({ error: '后台估算取消参数无效' }, { status: 400 })
  }

  try {
    const project = await getProject(query.data.projectId)
    if (!project) {
      return NextResponse.json({ error: '项目不存在或无权限' }, { status: 404 })
    }

    const run = await runs.retrieve<typeof generateEstimateTask>(runId)
    if (
      run.payload?.actorUserId !== project.created_by
      || run.payload?.projectId !== query.data.projectId
    ) {
      return NextResponse.json({ error: '后台估算任务与项目不匹配' }, { status: 403 })
    }
    await runs.cancel(runId)
    return NextResponse.json({ cancelled: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '取消后台估算失败' },
      { status: 500 }
    )
  }
}

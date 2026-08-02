import { NextResponse } from 'next/server'
import { runs } from '@trigger.dev/sdk'
import { z } from 'zod'
import type { generateEstimateTask } from '@/trigger/generate-estimate'
import { getProject } from '@/app/actions/projects'
import { getEstimateVersionSnapshot } from '@/app/actions/estimate-versions'

const querySchema = z.strictObject({
  projectId: z.uuid(),
})

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

    const run = await runs.retrieve<typeof generateEstimateTask>(runId)
    if (
      run.payload?.actorUserId !== project.created_by
      || run.payload?.projectId !== query.data.projectId
    ) {
      return NextResponse.json({ error: '后台估算任务与项目不匹配' }, { status: 403 })
    }
    const output = run.status === 'COMPLETED' ? run.output : undefined
    const estimateVersionId = output?.estimateVersionId
    const snapshot = estimateVersionId
      ? await getEstimateVersionSnapshot(query.data.projectId, { versionId: estimateVersionId })
      : null

    return NextResponse.json({
      status: run.status,
      isTerminal: terminalStatuses.has(run.status),
      estimateVersionId: snapshot?.version.id || null,
      revision: snapshot?.version.revision_no || null,
      error: run.error?.message,
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

import Link from 'next/link'
import { Suspense } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  FileUp,
  MessageCircle,
  Mic,
  Sparkles,
} from 'lucide-react'
import { notFound } from 'next/navigation'
import { getProject } from '@/app/actions/projects'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ApplyRequirementSourceButton } from '@/components/project/apply-requirement-source-button'
import { ConfirmRequirementButton } from '@/components/project/confirm-requirement-button'
import { RequirementSourceActions } from '@/components/project/requirement-source-actions'
import {
  getRequirementWorkbench,
  type RequirementSourceKind,
  type RequirementSourceStatus,
} from '@/lib/requirements/workbench'
import { cn } from '@/lib/utils'

interface ProjectPageProps {
  params: Promise<{ id: string }>
}

const sourceIcons: Record<RequirementSourceKind, typeof FileText> = {
  text: FileText,
  document: FileUp,
  meeting: Mic,
  elicitation: MessageCircle,
}

const sourceTone: Record<RequirementSourceStatus, string> = {
  draft: 'border-amber-200 bg-amber-50/70 text-amber-800',
  processing: 'border-sky-200 bg-sky-50/70 text-sky-800',
  review_required: 'border-orange-200 bg-orange-50/70 text-orange-800',
  pending_changes: 'border-rose-200 bg-rose-50/70 text-rose-800',
  included: 'border-emerald-200 bg-emerald-50/70 text-emerald-800',
  failed: 'border-red-200 bg-red-50/70 text-red-800',
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) notFound()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Requirement workbench
          </p>
          <h2 className="text-2xl font-bold tracking-tight">需求工作台</h2>
          <p className="mt-1 text-muted-foreground">
            汇总文本、文档、会议和 AI 澄清，确认后形成方案分析的唯一正式输入。
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/projects/${id}/meetings`}>
            <Mic className="h-4 w-4" />会议来源管理
          </Link>
        </Button>
      </div>

      <Suspense fallback={<WorkbenchSkeleton />}>
        <RequirementWorkbenchContent projectId={id} />
      </Suspense>
    </div>
  )
}

async function RequirementWorkbenchContent({ projectId }: { projectId: string }) {
  const workbench = await getRequirementWorkbench(projectId)
  const baseline = workbench.currentBaseline
  const latestRequirement = workbench.latestRequirement
  const editableRequirement = workbench.editableRequirement
  const latestRequirementIncluded = Boolean(
    latestRequirement
      && workbench.sources.some((source) =>
        source.kind !== 'meeting'
        && source.id === latestRequirement.id
        && source.status === 'included',
      ),
  )
  const pendingSources = workbench.sources.filter((source) =>
    ['draft', 'review_required', 'pending_changes', 'failed'].includes(source.status),
  )
  const nextMeetingSource = pendingSources.find((source) => source.kind === 'meeting')
  const canConfirmInitialRequirement = !baseline && Boolean(latestRequirement)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden">
          <div className="h-1 bg-linear-to-r from-foreground via-foreground/45 to-transparent" />
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className={cn('h-5 w-5', baseline ? 'text-emerald-600' : 'text-muted-foreground')} />
                  当前正式需求
                </CardTitle>
                <CardDescription className="mt-1">
                  {baseline
                    ? `需求基线 V${baseline.revision_no} · 创建于 ${formatDate(baseline.created_at)}`
                    : '尚未形成正式需求，方案分析暂不可用。'}
                </CardDescription>
              </div>
              <Badge variant={baseline ? 'default' : 'secondary'}>
                {baseline ? `V${baseline.revision_no}` : '待确认'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {baseline ? (
              <div className="rounded-lg border bg-muted/35 p-4">
                <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-6">
                  {baseline.canonical_content}
                </p>
              </div>
            ) : latestRequirement ? (
              <div className="rounded-lg border border-dashed p-4">
                <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-6">
                  {latestRequirement.raw_content}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                先从下方任一入口添加需求来源。
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                正式版本不可直接覆盖，所有方案与成本分析都会绑定到该版本。
              </p>
              {canConfirmInitialRequirement && latestRequirement ? (
                <ConfirmRequirementButton
                  projectId={projectId}
                  requirementId={latestRequirement.id}
                />
              ) : baseline ? (
                <Button asChild>
                  <Link href={`/projects/${projectId}/analysis`}>
                    进入方案与成本分析<ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>待确认事项</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{workbench.pendingCount}</CardTitle>
            </CardHeader>
            <CardContent>
              {nextMeetingSource ? (
                <Button size="sm" variant="outline" asChild>
                  <Link href={nextMeetingSource.href}>处理下一项<ArrowRight className="h-4 w-4" /></Link>
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {workbench.pendingCount > 0 ? '请检查需求草稿并确认正式版本。' : '所有来源均已处理。'}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className={cn(workbench.estimateFreshness === 'stale' && 'border-amber-300 bg-amber-50/50')}>
            <CardHeader className="pb-3">
              <CardDescription>方案与成本状态</CardDescription>
              <CardTitle className="text-lg">
                {workbench.estimateFreshness === 'current'
                  ? `估算 V${workbench.latestEstimateRevision} 与需求一致`
                  : workbench.estimateFreshness === 'stale'
                    ? `估算 V${workbench.latestEstimateRevision} 基于旧需求`
                    : '尚未生成估算'}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {workbench.estimateFreshness === 'stale'
                ? '旧版本仍保留用于审计，请基于当前正式需求重新分析。'
                : workbench.estimateFreshness === 'current'
                  ? '可继续审核功能、成本与报告。'
                  : '确认正式需求后即可开始方案分析。'}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card id="requirement-sources" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>添加需求来源</CardTitle>
          <CardDescription>
            不同来源统一进入需求工作台，不再要求先理解各自的技术处理步骤。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RequirementSourceActions
            projectId={projectId}
            editableRequirement={editableRequirement}
            activeElicitationSessionId={workbench.activeElicitationSessionId}
            canUseElicitation={Boolean(baseline || latestRequirement)}
          />
          {latestRequirement?.source === 'elicitation' && !latestRequirementIncluded ? (
            <div className="mt-4 flex gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>最新 AI 澄清结果是不可编辑的待确认来源，请在下方来源列表确认后更新项目需求。</p>
            </div>
          ) : baseline && editableRequirement ? (
            <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>当前有一份尚未纳入正式需求的文本草稿，可通过“输入需求文本”继续查看。</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>需求来源</CardTitle>
              <CardDescription>最近添加的文本、文档、会议与 AI 澄清结果</CardDescription>
            </div>
            <Badge variant="outline">{workbench.sources.length} 条</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {workbench.sources.length > 0 ? (
            <div className="divide-y rounded-lg border">
              {workbench.sources.slice(0, 8).map((source) => {
                const Icon = sourceIcons[source.kind]
                return (
                  <div
                    key={`${source.kind}-${source.id}`}
                    className="group flex items-start gap-3 p-4 transition-colors hover:bg-muted/40"
                  >
                    <Link
                      href={source.href}
                      className="contents"
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{source.title}</span>
                          <Badge variant="outline" className={sourceTone[source.status]}>
                            {source.statusLabel}
                          </Badge>
                        </span>
                        <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">
                          {source.description || '暂无内容摘要'}
                        </span>
                        <span className="mt-2 block text-xs text-muted-foreground">
                          {formatDate(source.updatedAt)}
                        </span>
                      </span>
                    </Link>
                    {source.canApply ? (
                      <ApplyRequirementSourceButton
                        projectId={projectId}
                        requirementId={source.id}
                        expectedBaselineId={baseline?.id ?? null}
                        compact
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              暂无需求来源
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 rounded-lg border bg-muted/25 p-4 text-sm md:grid-cols-3">
        <ProcessStep icon={FileText} index="01" title="添加来源" description="文本、文档、会议或 AI 澄清" />
        <ProcessStep icon={Clock3} index="02" title="确认需求影响" description="只处理需要业务判断的内容" />
        <ProcessStep icon={Sparkles} index="03" title="方案与成本分析" description="绑定正式需求版本生成结果" />
      </div>
    </div>
  )
}

function ProcessStep({
  icon: Icon,
  index,
  title,
  description,
}: {
  icon: typeof FileText
  index: string
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-md border bg-background">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground">{index}</p>
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function WorkbenchSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card><CardContent className="space-y-4 py-6"><Skeleton className="h-7 w-40" /><Skeleton className="h-32 w-full" /><Skeleton className="ml-auto h-10 w-36" /></CardContent></Card>
        <div className="space-y-4"><Skeleton className="h-32 w-full rounded-xl" /><Skeleton className="h-32 w-full rounded-xl" /></div>
      </div>
      <Skeleton className="h-44 w-full rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-96 w-full rounded-xl" /><Skeleton className="h-96 w-full rounded-xl" /></div>
    </div>
  )
}

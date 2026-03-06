import type { GitToolContext } from './tools'

export type PrescanConfidence = 'low' | 'medium' | 'high'

export interface PrescanMetrics {
  fileCountEstimate: number
  dirCountEstimate: number
  maxDepthEstimate: number
  sampleSize: number
  requestCount: number
  rootSignalCount: number
}

export interface PrescanResult {
  maxSteps: number
  confidence: PrescanConfidence
  partial: boolean
  reason: string
  metrics: PrescanMetrics
  compressedTreeCsv: string
  compressedTreeRows: number
  compressedTreeBytes: number
}

interface ScanBudget {
  startAt: number
  deadlineMs: number
  maxRequests: number
  requestCount: number
  partial: boolean
  reasons: Set<string>
}

interface MetricAccumulator {
  fileCount: number
  dirCount: number
  maxDepth: number
  sampleSize: number
  rootSignalCount: number
}

interface TreeEntry {
  type: string
  path: string
}

const DEFAULT_STEPS = 16
const GITHUB_DEADLINE_MS = 2500
const GITHUB_MAX_REQUESTS = 4
const GITLAB_DEADLINE_MS = 12000
const GITLAB_MAX_REQUESTS = 120
const GITLAB_MAX_PAGES = 100
const ROOT_SIGNAL_DIRS = new Set([
  'apps',
  'services',
  'modules',
  'packages',
  'backend',
  'frontend',
  'src',
])

function createAccumulator(): MetricAccumulator {
  return {
    fileCount: 0,
    dirCount: 0,
    maxDepth: 0,
    sampleSize: 0,
    rootSignalCount: 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toLowerString(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

function markPartial(budget: ScanBudget, reason: string) {
  budget.partial = true
  budget.reasons.add(reason)
}

function remainingMs(budget: ScanBudget): number {
  return budget.deadlineMs - (Date.now() - budget.startAt)
}

function mapStatusReason(status: number): string {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not-found'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'upstream-5xx'
  return `upstream-${status}`
}

async function fetchWithBudget(
  budget: ScanBudget,
  url: string,
  init: RequestInit
): Promise<Response | null> {
  if (budget.requestCount >= budget.maxRequests) {
    markPartial(budget, 'request-budget-exhausted')
    return null
  }

  const remaining = remainingMs(budget)
  if (remaining <= 0) {
    markPartial(budget, 'deadline-exceeded')
    return null
  }

  budget.requestCount += 1

  const timeoutMs = Math.max(250, Math.min(remaining, 1200))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      markPartial(budget, 'request-timeout')
    } else {
      markPartial(budget, 'network-error')
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

function countDepth(path: unknown): number {
  if (typeof path !== 'string' || path.length === 0) return 0
  return path.split('/').length
}

function toConfidence(sampleSize: number, usedRecursiveData: boolean, partial: boolean): PrescanConfidence {
  let confidence: PrescanConfidence
  if (usedRecursiveData && sampleSize >= 120) confidence = 'high'
  else if (usedRecursiveData || sampleSize >= 60) confidence = 'medium'
  else confidence = 'low'

  if (!partial) return confidence
  if (confidence === 'high') return 'medium'
  if (confidence === 'medium') return 'low'
  return 'low'
}

function resolveSteps(metrics: MetricAccumulator, confidence: PrescanConfidence): number {
  const score = (
    Math.min(metrics.fileCount / 120, 5) +
    Math.min(metrics.dirCount / 30, 3) +
    Math.min(metrics.maxDepth / 6, 2) +
    Math.min(metrics.rootSignalCount * 0.7, 2)
  )

  let steps: number
  if (score < 3.5) steps = 10
  else if (score < 6.5) steps = 16
  else if (score < 9.5) steps = 24
  else steps = 32

  if (confidence === 'low') {
    return Math.min(steps + 2, 34)
  }
  return steps
}

function finalizeResult(
  budget: ScanBudget,
  metrics: MetricAccumulator,
  usedRecursiveData: boolean,
  entries: TreeEntry[]
): PrescanResult {
  const { csv, rows, bytes } = buildCompressedTreeCsv(entries)
  const confidence = toConfidence(metrics.sampleSize, usedRecursiveData, budget.partial)
  const maxSteps = resolveSteps(metrics, confidence)

  return {
    maxSteps,
    confidence,
    partial: budget.partial,
    reason: budget.reasons.size > 0 ? Array.from(budget.reasons).join(',') : 'ok',
    metrics: {
      fileCountEstimate: metrics.fileCount,
      dirCountEstimate: metrics.dirCount,
      maxDepthEstimate: metrics.maxDepth,
      sampleSize: metrics.sampleSize,
      requestCount: budget.requestCount,
      rootSignalCount: metrics.rootSignalCount,
    },
    compressedTreeCsv: csv,
    compressedTreeRows: rows,
    compressedTreeBytes: bytes,
  }
}

function applyRootSignal(metrics: MetricAccumulator, dirName: string) {
  if (ROOT_SIGNAL_DIRS.has(dirName.toLowerCase())) {
    metrics.rootSignalCount += 1
  }
}

function toTypeCode(type: string): string {
  if (type === 'tree' || type === 'dir') return 'D'
  if (type === 'blob' || type === 'file') return 'F'
  if (type === 'commit') return 'S'
  return 'U'
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function buildCompressedTreeCsv(entries: TreeEntry[]): { csv: string; rows: number; bytes: number } {
  const lines = ['t,d,p']
  for (const entry of entries) {
    const typeCode = toTypeCode(entry.type)
    const depth = countDepth(entry.path)
    lines.push(`${typeCode},${depth},${escapeCsv(entry.path)}`)
  }
  const csv = lines.join('\n')
  const bytes = new TextEncoder().encode(csv).length
  return {
    csv,
    rows: entries.length,
    bytes,
  }
}

async function scanGitHub(context: GitToolContext, budget: ScanBudget): Promise<PrescanResult> {
  const { owner, repo } = context.parsed
  const metrics = createAccumulator()
  const entries: TreeEntry[] = []
  let usedRecursiveData = false
  let defaultBranch = context.branch

  const repoRes = await fetchWithBudget(
    budget,
    `https://api.github.com/repos/${owner}/${repo}`,
    {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'presales-agent',
      },
    }
  )
  if (repoRes) {
    if (repoRes.ok) {
      const repoData: unknown = await repoRes.json()
      if (isRecord(repoData) && typeof repoData.default_branch === 'string') {
        defaultBranch = repoData.default_branch
      }
    } else {
      markPartial(budget, mapStatusReason(repoRes.status))
    }
  }

  const refParam = context.branch ? `?ref=${encodeURIComponent(context.branch)}` : ''
  const rootRes = await fetchWithBudget(
    budget,
    `https://api.github.com/repos/${owner}/${repo}/contents/${refParam}`,
    {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'presales-agent',
      },
    }
  )
  if (rootRes) {
    if (rootRes.ok) {
      const rootData: unknown = await rootRes.json()
      if (Array.isArray(rootData)) {
        metrics.sampleSize += rootData.length
        if (rootData.length > 0) metrics.maxDepth = Math.max(metrics.maxDepth, 1)
        for (const item of rootData) {
          if (!isRecord(item)) continue
          const itemType = toLowerString(item.type)
          if (itemType === 'file') metrics.fileCount += 1
          if (itemType === 'dir') {
            metrics.dirCount += 1
            applyRootSignal(metrics, typeof item.name === 'string' ? item.name : '')
          }
          if (typeof item.path === 'string' && item.path.length > 0) {
            entries.push({
              type: itemType === 'dir' ? 'tree' : itemType,
              path: item.path,
            })
          }
        }
      }
    } else {
      markPartial(budget, mapStatusReason(rootRes.status))
    }
  }

  const recursiveRef = context.branch || defaultBranch || 'HEAD'
  const recursiveRes = await fetchWithBudget(
    budget,
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(recursiveRef)}?recursive=1`,
    {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'presales-agent',
      },
    }
  )

  if (recursiveRes) {
    if (recursiveRes.ok) {
      const treeData: unknown = await recursiveRes.json()
      if (isRecord(treeData) && Array.isArray(treeData.tree)) {
        usedRecursiveData = true
        metrics.fileCount = 0
        metrics.dirCount = 0
        metrics.maxDepth = 0
        metrics.sampleSize = treeData.tree.length
        entries.length = 0
        for (const item of treeData.tree) {
          if (!isRecord(item)) continue
          const itemType = toLowerString(item.type)
          if (itemType === 'blob') metrics.fileCount += 1
          if (itemType === 'tree') metrics.dirCount += 1
          const itemPath = typeof item.path === 'string' ? item.path : ''
          metrics.maxDepth = Math.max(metrics.maxDepth, countDepth(itemPath))
          if (itemPath.length > 0 && (itemType === 'blob' || itemType === 'tree' || itemType === 'commit')) {
            entries.push({ type: itemType, path: itemPath })
          }
        }
        if (treeData.truncated === true) {
          markPartial(budget, 'github-tree-truncated')
        }
      }
    } else {
      markPartial(budget, mapStatusReason(recursiveRes.status))
    }
  }

  return finalizeResult(budget, metrics, usedRecursiveData, entries)
}

type GitLabTreeItem = {
  type: 'blob' | 'tree'
  name: string
  path: string
}

function normalizeGitLabTree(data: unknown): GitLabTreeItem[] {
  if (!Array.isArray(data)) return []
  const normalized: GitLabTreeItem[] = []
  for (const item of data) {
    if (!isRecord(item)) continue
    if (item.type !== 'blob' && item.type !== 'tree') continue
    if (typeof item.name !== 'string' || typeof item.path !== 'string') continue
    normalized.push({ type: item.type, name: item.name, path: item.path })
  }
  return normalized
}

async function scanGitLab(context: GitToolContext, budget: ScanBudget): Promise<PrescanResult> {
  const { baseUrl, headers, branch: specifiedBranch } = context
  const { owner, repo } = context.parsed
  const metrics = createAccumulator()
  const entries: TreeEntry[] = []
  let usedRecursiveData = false
  let defaultBranch = specifiedBranch
  const projectPath = encodeURIComponent(`${owner}/${repo}`)

  const projectRes = await fetchWithBudget(
    budget,
    `${baseUrl}/api/v4/projects/${projectPath}`,
    { headers }
  )
  if (projectRes) {
    if (projectRes.ok) {
      const projectData: unknown = await projectRes.json()
      if (isRecord(projectData) && typeof projectData.default_branch === 'string') {
        defaultBranch = projectData.default_branch
      }
    } else {
      markPartial(budget, mapStatusReason(projectRes.status))
    }
  }

  const ref = specifiedBranch || defaultBranch
  const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : ''
  let nextPage = '1'
  let scannedPages = 0

  while (nextPage && scannedPages < GITLAB_MAX_PAGES) {
    const page = nextPage
    const recursiveRes = await fetchWithBudget(
      budget,
      `${baseUrl}/api/v4/projects/${projectPath}/repository/tree?recursive=true&per_page=100&page=${page}${refParam}`,
      { headers }
    )
    if (!recursiveRes) break

    if (!recursiveRes.ok) {
      markPartial(budget, mapStatusReason(recursiveRes.status))
      break
    }

    usedRecursiveData = true
    const recursiveData: unknown = await recursiveRes.json()
    const items = normalizeGitLabTree(recursiveData)
    metrics.sampleSize += items.length

    for (const item of items) {
      if (item.type === 'blob') metrics.fileCount += 1
      if (item.type === 'tree') {
        metrics.dirCount += 1
        if (countDepth(item.path) === 1) {
          applyRootSignal(metrics, item.name)
        }
      }
      metrics.maxDepth = Math.max(metrics.maxDepth, countDepth(item.path))
      entries.push({ type: item.type, path: item.path })
    }

    const headerNext = recursiveRes.headers.get('x-next-page')
    nextPage = headerNext && headerNext !== page ? headerNext : ''
    scannedPages += 1
  }

  if (nextPage) {
    markPartial(budget, 'gitlab-recursive-paginated')
  }

  return finalizeResult(budget, metrics, usedRecursiveData, entries)
}

export async function estimateExplorationBudget(context: GitToolContext): Promise<PrescanResult> {
  const isGitLab = context.parsed.platform === 'gitlab'
  const budget: ScanBudget = {
    startAt: Date.now(),
    deadlineMs: isGitLab ? GITLAB_DEADLINE_MS : GITHUB_DEADLINE_MS,
    maxRequests: isGitLab ? GITLAB_MAX_REQUESTS : GITHUB_MAX_REQUESTS,
    requestCount: 0,
    partial: false,
    reasons: new Set<string>(),
  }

  try {
    let result: PrescanResult
    if (context.parsed.platform === 'github') {
      result = await scanGitHub(context, budget)
    } else if (context.parsed.platform === 'gitlab') {
      result = await scanGitLab(context, budget)
    } else {
      result = {
        maxSteps: DEFAULT_STEPS,
        confidence: 'low',
        partial: true,
        reason: 'unsupported-platform',
        metrics: {
          fileCountEstimate: 0,
          dirCountEstimate: 0,
          maxDepthEstimate: 0,
          sampleSize: 0,
          requestCount: 0,
          rootSignalCount: 0,
        },
        compressedTreeCsv: 't,d,p',
        compressedTreeRows: 0,
        compressedTreeBytes: 5,
      }
    }

    console.log('[ParseGitFunctions] 预扫描结果:', {
      platform: context.parsed.platform,
      maxSteps: result.maxSteps,
      confidence: result.confidence,
      partial: result.partial,
      reason: result.reason,
      metrics: result.metrics,
      compressedTreeRows: result.compressedTreeRows,
      compressedTreeBytes: result.compressedTreeBytes,
    })

    return result
  } catch (error) {
    console.warn('[ParseGitFunctions] 预扫描失败，使用默认预算:', error)
    return {
      maxSteps: DEFAULT_STEPS,
      confidence: 'low',
      partial: true,
      reason: 'prescan-exception',
      metrics: {
        fileCountEstimate: 0,
        dirCountEstimate: 0,
        maxDepthEstimate: 0,
        sampleSize: 0,
        requestCount: budget.requestCount,
        rootSignalCount: 0,
      },
      compressedTreeCsv: 't,d,p',
      compressedTreeRows: 0,
      compressedTreeBytes: 5,
    }
  }
}

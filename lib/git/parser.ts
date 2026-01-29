/**
 * Git 仓库解析工具
 *
 * 支持解析 GitHub、GitLab（含自托管）、Gitee 等平台的仓库 URL
 * 获取仓库的基本信息、README、package.json 等文件内容
 */

export type GitPlatform = 'github' | 'gitlab' | 'gitee' | 'unknown'

export interface ParsedGitUrl {
  platform: GitPlatform
  host: string // 主机地址，如 github.com 或 172.26.1.194
  owner: string
  repo: string
  branch?: string
  rawUrl: string
}

export interface RepoInfo {
  name: string
  description: string | null
  language: string | null
  topics: string[]
  stars: number
  defaultBranch: string
}

export interface RepoFiles {
  readme: string | null
  packageJson: Record<string, unknown> | null
  pomXml: string | null
}

export interface GitRepoData {
  url: string
  platform: GitPlatform
  info: RepoInfo | null
  files: RepoFiles
  error?: string
}

/**
 * 解析 Git 仓库 URL
 */
export function parseGitUrl(url: string): ParsedGitUrl | null {
  const trimmedUrl = url.trim()

  // GitHub: https://github.com/owner/repo or git@github.com:owner/repo.git
  const githubHttps = /^https?:\/\/github\.com\/([^\/]+)\/([^\/\s#?]+)/
  const githubSsh = /^git@github\.com:([^\/]+)\/([^\/\s]+?)(?:\.git)?$/

  // GitLab 官方: https://gitlab.com/owner/repo
  const gitlabHttps = /^https?:\/\/gitlab\.com\/([^\/]+)\/([^\/\s#?]+)/
  const gitlabSsh = /^git@gitlab\.com:([^\/]+)\/([^\/\s]+?)(?:\.git)?$/

  // Gitee: https://gitee.com/owner/repo
  const giteeHttps = /^https?:\/\/gitee\.com\/([^\/]+)\/([^\/\s#?]+)/
  const giteeSsh = /^git@gitee\.com:([^\/]+)\/([^\/\s]+?)(?:\.git)?$/

  // 通用 HTTP(S) URL: https://host/owner/repo
  const genericHttps = /^(https?):\/\/([^\/]+)\/([^\/]+)\/([^\/\s#?]+)/

  let match: RegExpMatchArray | null
  let platform: GitPlatform = 'unknown'
  let host = ''
  let owner = ''
  let repo = ''

  if ((match = trimmedUrl.match(githubHttps)) || (match = trimmedUrl.match(githubSsh))) {
    platform = 'github'
    host = 'github.com'
    owner = match[1]
    repo = match[2].replace(/\.git$/, '')
  } else if ((match = trimmedUrl.match(gitlabHttps)) || (match = trimmedUrl.match(gitlabSsh))) {
    platform = 'gitlab'
    host = 'gitlab.com'
    owner = match[1]
    repo = match[2].replace(/\.git$/, '')
  } else if ((match = trimmedUrl.match(giteeHttps)) || (match = trimmedUrl.match(giteeSsh))) {
    platform = 'gitee'
    host = 'gitee.com'
    owner = match[1]
    repo = match[2].replace(/\.git$/, '')
  } else if ((match = trimmedUrl.match(genericHttps))) {
    // 对于其他 HTTP(S) URL，尝试作为 GitLab 实例处理
    platform = 'gitlab'
    host = match[2]
    owner = match[3]
    repo = match[4].replace(/\.git$/, '')
  }

  if (platform === 'unknown' || !owner || !repo) {
    return null
  }

  return {
    platform,
    host,
    owner,
    repo,
    rawUrl: trimmedUrl,
  }
}

/**
 * 获取 GitHub 仓库信息
 */
async function fetchGitHubRepo(owner: string, repo: string): Promise<{ info: RepoInfo | null; files: RepoFiles }> {
  const files: RepoFiles = {
    readme: null,
    packageJson: null,
    pomXml: null,
  }

  let info: RepoInfo | null = null

  try {
    // 获取仓库基本信息
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'presales-agent',
      },
    })

    if (repoRes.ok) {
      const repoData = await repoRes.json()
      info = {
        name: repoData.name,
        description: repoData.description,
        language: repoData.language,
        topics: repoData.topics || [],
        stars: repoData.stargazers_count,
        defaultBranch: repoData.default_branch,
      }
    }
  } catch (e) {
    console.error('[GitParser] 获取 GitHub 仓库信息失败:', e)
  }

  const branch = info?.defaultBranch || 'main'

  // 并行获取文件内容
  const [readmeRes, packageRes, pomRes] = await Promise.allSettled([
    fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`),
    fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/package.json`),
    fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/pom.xml`),
  ])

  if (readmeRes.status === 'fulfilled' && readmeRes.value.ok) {
    files.readme = await readmeRes.value.text()
  }

  if (packageRes.status === 'fulfilled' && packageRes.value.ok) {
    try {
      files.packageJson = await packageRes.value.json()
    } catch {
      // 忽略 JSON 解析错误
    }
  }

  if (pomRes.status === 'fulfilled' && pomRes.value.ok) {
    files.pomXml = await pomRes.value.text()
  }

  return { info, files }
}

/**
 * 获取 GitLab 仓库信息（支持自托管实例和私有仓库）
 */
async function fetchGitLabRepo(
  host: string,
  owner: string,
  repo: string,
  token?: string
): Promise<{ info: RepoInfo | null; files: RepoFiles }> {
  const files: RepoFiles = {
    readme: null,
    packageJson: null,
    pomXml: null,
  }

  let info: RepoInfo | null = null
  const projectPath = encodeURIComponent(`${owner}/${repo}`)

  // 确定协议：对于 IP 地址或内网域名，可能需要 http
  const isLocalHost = /^(localhost|127\.|192\.|172\.|10\.)/.test(host) || /^\d+\.\d+\.\d+\.\d+/.test(host)
  const protocol = isLocalHost ? 'http' : 'https'
  const baseUrl = `${protocol}://${host}`

  // 构建请求头，私有仓库需要 Token
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  }
  if (token) {
    headers['PRIVATE-TOKEN'] = token
  }

  try {
    const repoRes = await fetch(`${baseUrl}/api/v4/projects/${projectPath}`, {
      headers,
    })

    if (repoRes.ok) {
      const repoData = await repoRes.json()
      info = {
        name: repoData.name,
        description: repoData.description,
        language: null, // GitLab API 需要单独调用获取语言
        topics: repoData.topics || [],
        stars: repoData.star_count,
        defaultBranch: repoData.default_branch,
      }
    }
  } catch (e) {
    console.error('[GitParser] 获取 GitLab 仓库信息失败:', e)
  }

  const branch = info?.defaultBranch || 'main'

  // 获取文件内容（私有仓库需要 Token）
  const fileHeaders: Record<string, string> = {}
  if (token) {
    fileHeaders['PRIVATE-TOKEN'] = token
  }

  const [readmeRes, packageRes, pomRes] = await Promise.allSettled([
    fetch(`${baseUrl}/${owner}/${repo}/-/raw/${branch}/README.md`, { headers: fileHeaders }),
    fetch(`${baseUrl}/${owner}/${repo}/-/raw/${branch}/package.json`, { headers: fileHeaders }),
    fetch(`${baseUrl}/${owner}/${repo}/-/raw/${branch}/pom.xml`, { headers: fileHeaders }),
  ])

  if (readmeRes.status === 'fulfilled' && readmeRes.value.ok) {
    files.readme = await readmeRes.value.text()
  }

  if (packageRes.status === 'fulfilled' && packageRes.value.ok) {
    try {
      files.packageJson = await packageRes.value.json()
    } catch {
      // 忽略 JSON 解析错误
    }
  }

  if (pomRes.status === 'fulfilled' && pomRes.value.ok) {
    files.pomXml = await pomRes.value.text()
  }

  return { info, files }
}

/**
 * 获取 Gitee 仓库信息
 */
async function fetchGiteeRepo(owner: string, repo: string): Promise<{ info: RepoInfo | null; files: RepoFiles }> {
  const files: RepoFiles = {
    readme: null,
    packageJson: null,
    pomXml: null,
  }

  let info: RepoInfo | null = null

  try {
    const repoRes = await fetch(`https://gitee.com/api/v5/repos/${owner}/${repo}`, {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (repoRes.ok) {
      const repoData = await repoRes.json()
      info = {
        name: repoData.name,
        description: repoData.description,
        language: repoData.language,
        topics: [],
        stars: repoData.stargazers_count,
        defaultBranch: repoData.default_branch,
      }
    }
  } catch (e) {
    console.error('[GitParser] 获取 Gitee 仓库信息失败:', e)
  }

  const branch = info?.defaultBranch || 'master'

  // 获取文件内容
  const [readmeRes, packageRes, pomRes] = await Promise.allSettled([
    fetch(`https://gitee.com/${owner}/${repo}/raw/${branch}/README.md`),
    fetch(`https://gitee.com/${owner}/${repo}/raw/${branch}/package.json`),
    fetch(`https://gitee.com/${owner}/${repo}/raw/${branch}/pom.xml`),
  ])

  if (readmeRes.status === 'fulfilled' && readmeRes.value.ok) {
    files.readme = await readmeRes.value.text()
  }

  if (packageRes.status === 'fulfilled' && packageRes.value.ok) {
    try {
      files.packageJson = await packageRes.value.json()
    } catch {
      // 忽略 JSON 解析错误
    }
  }

  if (pomRes.status === 'fulfilled' && pomRes.value.ok) {
    files.pomXml = await pomRes.value.text()
  }

  return { info, files }
}

export interface FetchOptions {
  /** GitLab/GitHub Personal Access Token（用于私有仓库） */
  token?: string
}

/**
 * 获取 Git 仓库数据
 *
 * @param url - Git 仓库 URL
 * @param options - 可选配置，如 token 用于私有仓库授权
 */
export async function fetchGitRepoData(url: string, options?: FetchOptions): Promise<GitRepoData> {
  const parsed = parseGitUrl(url)

  if (!parsed) {
    return {
      url,
      platform: 'unknown',
      info: null,
      files: {
        readme: null,
        packageJson: null,
        pomXml: null,
      },
      error: '无法解析 Git 仓库地址，请检查 URL 格式是否正确',
    }
  }

  const { platform, host, owner, repo } = parsed
  const { token } = options || {}

  let result: { info: RepoInfo | null; files: RepoFiles }

  switch (platform) {
    case 'github':
      result = await fetchGitHubRepo(owner, repo)
      break
    case 'gitlab':
      result = await fetchGitLabRepo(host, owner, repo, token)
      break
    case 'gitee':
      result = await fetchGiteeRepo(owner, repo)
      break
    default:
      return {
        url,
        platform,
        info: null,
        files: {
          readme: null,
          packageJson: null,
          pomXml: null,
        },
        error: '暂不支持该平台',
      }
  }

  // 如果没有获取到任何信息，返回错误
  if (!result.info && !result.files.readme && !result.files.packageJson && !result.files.pomXml) {
    // 根据平台给出更具体的错误提示
    let errorMsg = '无法获取仓库信息，请确认仓库地址正确'
    if (platform === 'gitlab' && !token) {
      errorMsg += '。如为私有仓库，请提供 GitLab Access Token'
    } else if (platform === 'gitlab' && token) {
      errorMsg += '。请检查 Token 是否有效且具有 read_repository 权限'
    } else {
      errorMsg += '且为公开仓库'
    }

    return {
      url,
      platform,
      info: null,
      files: result.files,
      error: errorMsg,
    }
  }

  return {
    url,
    platform,
    info: result.info,
    files: result.files,
  }
}

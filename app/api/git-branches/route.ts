/**
 * 获取 Git 仓库分支列表
 *
 * POST /api/git-branches
 * Body: { url: string, token?: string }
 */

import { parseGitUrl } from '@/lib/git/parser'

interface Branch {
  name: string
  isDefault: boolean
}

export async function POST(req: Request) {
  try {
    const { url, token } = await req.json()

    if (!url || typeof url !== 'string') {
      return Response.json(
        { success: false, error: '请提供有效的 Git 仓库地址' },
        { status: 400 }
      )
    }

    const parsed = parseGitUrl(url)
    if (!parsed) {
      return Response.json(
        { success: false, error: '无法解析 Git 仓库地址，请检查 URL 格式是否正确' },
        { status: 400 }
      )
    }

    const { platform, host, owner, repo } = parsed

    // 确定协议
    const isLocalHost = /^(localhost|127\.|192\.|172\.|10\.)/.test(host) || /^\d+\.\d+\.\d+\.\d+/.test(host)
    const protocol = isLocalHost ? 'http' : 'https'
    const baseUrl = `${protocol}://${host}`

    let branches: Branch[] = []
    let defaultBranch: string | null = null

    if (platform === 'gitlab') {
      const projectPath = encodeURIComponent(`${owner}/${repo}`)
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (token) {
        headers['PRIVATE-TOKEN'] = token
      }

      // 先获取项目信息以获取默认分支
      try {
        const projectRes = await fetch(`${baseUrl}/api/v4/projects/${projectPath}`, { headers })
        if (projectRes.ok) {
          const projectData = await projectRes.json()
          defaultBranch = projectData.default_branch
        }
      } catch {
        // 忽略错误，继续获取分支列表
      }

      // 获取分支列表
      const branchesRes = await fetch(
        `${baseUrl}/api/v4/projects/${projectPath}/repository/branches?per_page=100`,
        { headers }
      )

      if (!branchesRes.ok) {
        return Response.json(
          {
            success: false,
            error: `获取分支列表失败: ${branchesRes.status}${!token ? '。如为私有仓库，请提供 Access Token' : ''}`,
          },
          { status: 400 }
        )
      }

      const branchesData = await branchesRes.json()
      branches = branchesData.map((b: { name: string; default?: boolean }) => ({
        name: b.name,
        isDefault: b.default || b.name === defaultBranch,
      }))
    } else if (platform === 'github') {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'presales-agent',
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      // 先获取仓库信息以获取默认分支
      try {
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
        if (repoRes.ok) {
          const repoData = await repoRes.json()
          defaultBranch = repoData.default_branch
        }
      } catch {
        // 忽略错误
      }

      // 获取分支列表
      const branchesRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
        { headers }
      )

      if (!branchesRes.ok) {
        return Response.json(
          {
            success: false,
            error: `获取分支列表失败: ${branchesRes.status}`,
          },
          { status: 400 }
        )
      }

      const branchesData = await branchesRes.json()
      branches = branchesData.map((b: { name: string }) => ({
        name: b.name,
        isDefault: b.name === defaultBranch,
      }))
    } else if (platform === 'gitee') {
      // 获取仓库信息
      try {
        const repoRes = await fetch(`https://gitee.com/api/v5/repos/${owner}/${repo}`)
        if (repoRes.ok) {
          const repoData = await repoRes.json()
          defaultBranch = repoData.default_branch
        }
      } catch {
        // 忽略错误
      }

      // 获取分支列表
      const branchesRes = await fetch(
        `https://gitee.com/api/v5/repos/${owner}/${repo}/branches`
      )

      if (!branchesRes.ok) {
        return Response.json(
          { success: false, error: `获取分支列表失败: ${branchesRes.status}` },
          { status: 400 }
        )
      }

      const branchesData = await branchesRes.json()
      branches = branchesData.map((b: { name: string }) => ({
        name: b.name,
        isDefault: b.name === defaultBranch,
      }))
    } else {
      return Response.json(
        { success: false, error: '暂不支持该平台' },
        { status: 400 }
      )
    }

    // 将默认分支排在第一位
    branches.sort((a, b) => {
      if (a.isDefault) return -1
      if (b.isDefault) return 1
      return a.name.localeCompare(b.name)
    })

    return Response.json({
      success: true,
      branches,
      defaultBranch,
    })
  } catch (error) {
    console.error('[GitBranches] 获取分支失败:', error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '获取分支列表失败',
      },
      { status: 500 }
    )
  }
}

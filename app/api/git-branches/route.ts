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

      // 构建请求头，支持 PRIVATE-TOKEN 和 OAuth Bearer Token 两种格式
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (token) {
        // glpat- 开头的是 Personal Access Token，使用 PRIVATE-TOKEN 头
        // 其他格式（如 OAuth token）使用 Authorization: Bearer
        if (token.startsWith('glpat-') || !token.includes('.')) {
          headers['PRIVATE-TOKEN'] = token
        } else {
          headers['Authorization'] = `Bearer ${token}`
        }
      }

      const apiUrl = `${baseUrl}/api/v4/projects/${projectPath}`
      console.log('[GitBranches] GitLab API URL:', apiUrl, 'Token provided:', !!token)

      // 先获取项目信息以获取默认分支
      try {
        const projectRes = await fetch(apiUrl, { headers })
        if (projectRes.ok) {
          const projectData = await projectRes.json()
          defaultBranch = projectData.default_branch
        } else {
          const errText = await projectRes.text().catch(() => '')
          console.log('[GitBranches] 获取项目信息失败:', projectRes.status, errText.slice(0, 200))

          // 如果项目信息就 403 了，尝试用另一种 Token 格式重试
          if (projectRes.status === 403 && token) {
            const altHeaders: Record<string, string> = { Accept: 'application/json' }
            if (headers['PRIVATE-TOKEN']) {
              altHeaders['Authorization'] = `Bearer ${token}`
            } else {
              altHeaders['PRIVATE-TOKEN'] = token
            }

            const retryRes = await fetch(apiUrl, { headers: altHeaders })
            if (retryRes.ok) {
              // 另一种格式有效，切换 headers
              console.log('[GitBranches] 使用备选 Token 格式成功')
              Object.assign(headers, altHeaders)
              const projectData = await retryRes.json()
              defaultBranch = projectData.default_branch
            }
          }
        }
      } catch {
        // 忽略错误，继续获取分支列表
      }

      // 获取分支列表
      const branchesUrl = `${apiUrl}/repository/branches?per_page=100`
      const branchesRes = await fetch(branchesUrl, { headers })

      if (!branchesRes.ok) {
        const errBody = await branchesRes.text().catch(() => '')
        console.error('[GitBranches] 获取分支失败:', branchesRes.status, errBody.slice(0, 500))

        let errorMsg = `获取分支列表失败: ${branchesRes.status}`
        if (branchesRes.status === 401) {
          errorMsg += '。Token 无效或已过期，请检查后重试'
        } else if (branchesRes.status === 403) {
          if (!token) {
            errorMsg += '。如为私有仓库，请提供 Access Token'
          } else if (errBody.includes('insufficient_scope')) {
            errorMsg += '。Token 权限不足，read_repository 仅支持 Git 克隆，REST API 需要 read_api 权限。请重新创建 Token 并勾选 read_api'
          } else {
            errorMsg += '。Token 权限不足，请确保 Token 拥有 read_api 权限'
          }
        } else if (branchesRes.status === 404) {
          errorMsg += '。仓库不存在或无权访问'
        }

        return Response.json(
          { success: false, error: errorMsg },
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

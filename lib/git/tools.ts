/**
 * Git 仓库访问工具
 *
 * 提供给 AI 使用的工具函数，用于动态访问仓库内容
 * 本地服务作为代理，解决内网访问问题
 */

import { tool } from 'ai'
import { z } from 'zod'
import { parseGitUrl } from './parser'

export interface GitToolContext {
  /** Git 仓库 URL */
  url: string
  /** 访问令牌（私有仓库） */
  token?: string
  /** 指定分支 */
  branch?: string
  /** 解析后的信息 */
  parsed: NonNullable<ReturnType<typeof parseGitUrl>>
  /** 基础 URL */
  baseUrl: string
  /** 请求头 */
  headers: Record<string, string>
}

/**
 * 创建 Git 仓库访问工具上下文
 */
export function createGitToolContext(url: string, token?: string, branch?: string): GitToolContext | null {
  const parsed = parseGitUrl(url)
  if (!parsed) return null

  const { host } = parsed

  // 确定协议
  const isLocalHost = /^(localhost|127\.|192\.|172\.|10\.)/.test(host) || /^\d+\.\d+\.\d+\.\d+/.test(host)
  const protocol = isLocalHost ? 'http' : 'https'
  const baseUrl = `${protocol}://${host}`

  // 构建请求头
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  }
  if (token) {
    headers['PRIVATE-TOKEN'] = token
  }

  return {
    url,
    token,
    branch,
    parsed,
    baseUrl,
    headers,
  }
}

/**
 * 创建 Git 仓库访问工具集
 */
export function createGitTools(context: GitToolContext) {
  const { parsed, baseUrl, headers, branch: specifiedBranch } = context
  const { owner, repo, platform } = parsed

  // 获取仓库的目录树
  const getRepoTree = tool({
    description: '获取仓库的目录结构树，了解项目的文件组织。建议首先调用此工具了解项目结构。',
    inputSchema: z.object({
      path: z.string().optional().describe('要查看的目录路径，默认为根目录'),
      recursive: z.boolean().optional().describe('是否递归获取子目录，默认 false'),
    }),
    execute: async ({ path = '', recursive = false }) => {
      try {
        if (platform === 'gitlab') {
          const projectPath = encodeURIComponent(`${owner}/${repo}`)
          const treePath = path ? `&path=${encodeURIComponent(path)}` : ''
          const recursiveParam = recursive ? '&recursive=true' : ''
          const refParam = specifiedBranch ? `&ref=${encodeURIComponent(specifiedBranch)}` : ''

          const res = await fetch(
            `${baseUrl}/api/v4/projects/${projectPath}/repository/tree?per_page=100${treePath}${recursiveParam}${refParam}`,
            { headers }
          )

          if (!res.ok) {
            return { error: `获取目录失败: ${res.status}`, files: [] }
          }

          const tree = await res.json()
          const files = tree.map((item: { name: string; type: string; path: string }) => ({
            name: item.name,
            type: item.type, // 'blob' 或 'tree'
            path: item.path,
          }))

          return { files, total: files.length }
        }

        // GitHub
        if (platform === 'github') {
          const refParam = specifiedBranch ? `?ref=${encodeURIComponent(specifiedBranch)}` : ''
          const res = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${path}${refParam}`,
            {
              headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'presales-agent',
              },
            }
          )

          if (!res.ok) {
            return { error: `获取目录失败: ${res.status}`, files: [] }
          }

          const contents = await res.json()
          const items = Array.isArray(contents) ? contents : [contents]
          const files = items.map((item: { name: string; type: string; path: string }) => ({
            name: item.name,
            type: item.type === 'dir' ? 'tree' : 'blob',
            path: item.path,
          }))

          return { files, total: files.length }
        }

        return { error: '暂不支持该平台', files: [] }
      } catch (e) {
        return { error: `获取目录失败: ${e instanceof Error ? e.message : '未知错误'}`, files: [] }
      }
    },
  })

  // 读取文件内容
  const readFile = tool({
    description: '读取仓库中指定文件的内容。可用于读取 README、配置文件、代码文件等。',
    inputSchema: z.object({
      path: z.string().describe('文件路径，如 "README.md" 或 "src/index.ts"'),
    }),
    execute: async ({ path }) => {
      try {
        if (platform === 'gitlab') {
          const projectPath = encodeURIComponent(`${owner}/${repo}`)

          // 使用指定分支或获取默认分支
          let branch = specifiedBranch || 'master'

          if (!specifiedBranch) {
            try {
              const projectRes = await fetch(`${baseUrl}/api/v4/projects/${projectPath}`, { headers })
              if (projectRes.ok) {
                const projectData = await projectRes.json()
                branch = projectData.default_branch || 'master'
              }
            } catch {
              // 使用默认分支
            }
          }

          // 使用 GitLab API 获取文件内容（比 raw URL 更可靠，支持认证）
          const filePath = encodeURIComponent(path)
          const apiUrl = `${baseUrl}/api/v4/projects/${projectPath}/repository/files/${filePath}/raw?ref=${branch}`

          console.log('[GitTools] readFile:', { path, branch, apiUrl })

          const res = await fetch(apiUrl, { headers })

          if (!res.ok) {
            console.log('[GitTools] readFile failed:', res.status, res.statusText)
            return { error: `文件不存在或无法访问: ${path} (${res.status})`, content: null }
          }

          const content = await res.text()
          // 限制内容长度，避免 token 超限
          const truncated = content.length > 5000
          return {
            path,
            content: truncated ? content.slice(0, 5000) + '\n...(内容已截断)' : content,
            truncated,
            size: content.length,
          }
        }

        // GitHub
        if (platform === 'github') {
          // 使用指定分支或 HEAD
          const ref = specifiedBranch || 'HEAD'
          const res = await fetch(
            `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`,
            {
              headers: {
                'User-Agent': 'presales-agent',
              },
            }
          )

          if (!res.ok) {
            return { error: `文件不存在或无法访问: ${path}`, content: null }
          }

          const content = await res.text()
          const truncated = content.length > 5000
          return {
            path,
            content: truncated ? content.slice(0, 5000) + '\n...(内容已截断)' : content,
            truncated,
            size: content.length,
          }
        }

        return { error: '暂不支持该平台', content: null }
      } catch (e) {
        console.error('[GitTools] readFile error:', e)
        return { error: `读取文件失败: ${e instanceof Error ? e.message : '未知错误'}`, content: null }
      }
    },
  })

  // 获取仓库基本信息
  const getRepoInfo = tool({
    description: '获取仓库的基本信息，包括名称、描述、主要语言、星标数等。',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        if (platform === 'gitlab') {
          const projectPath = encodeURIComponent(`${owner}/${repo}`)
          const res = await fetch(`${baseUrl}/api/v4/projects/${projectPath}`, { headers })

          if (!res.ok) {
            return { error: `获取仓库信息失败: ${res.status}` }
          }

          const data = await res.json()
          return {
            name: data.name,
            description: data.description || '无描述',
            defaultBranch: data.default_branch,
            stars: data.star_count,
            topics: data.topics || [],
            createdAt: data.created_at,
            lastActivity: data.last_activity_at,
          }
        }

        // GitHub
        if (platform === 'github') {
          const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: {
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'presales-agent',
            },
          })

          if (!res.ok) {
            return { error: `获取仓库信息失败: ${res.status}` }
          }

          const data = await res.json()
          return {
            name: data.name,
            description: data.description || '无描述',
            language: data.language,
            defaultBranch: data.default_branch,
            stars: data.stargazers_count,
            topics: data.topics || [],
            createdAt: data.created_at,
            lastActivity: data.updated_at,
          }
        }

        return { error: '暂不支持该平台' }
      } catch (e) {
        return { error: `获取仓库信息失败: ${e instanceof Error ? e.message : '未知错误'}` }
      }
    },
  })

  // 搜索文件
  const searchFiles = tool({
    description: '在仓库中搜索文件名匹配的文件。用于查找特定类型的文件。',
    inputSchema: z.object({
      filename: z.string().describe('要搜索的文件名或文件名模式，如 "package.json" 或 ".md"'),
    }),
    execute: async ({ filename }) => {
      try {
        if (platform === 'gitlab') {
          const projectPath = encodeURIComponent(`${owner}/${repo}`)
          const refParam = specifiedBranch ? `&ref=${encodeURIComponent(specifiedBranch)}` : ''
          const res = await fetch(
            `${baseUrl}/api/v4/projects/${projectPath}/repository/tree?recursive=true&per_page=100${refParam}`,
            { headers }
          )

          if (!res.ok) {
            return { error: `搜索失败: ${res.status}`, files: [] }
          }

          const tree = await res.json()
          const files = tree
            .filter((item: { type: string; name: string }) =>
              item.type === 'blob' && item.name.toLowerCase().includes(filename.toLowerCase())
            )
            .map((item: { path: string; name: string }) => item.path)
            .slice(0, 20)

          return { files, total: files.length }
        }

        // GitHub - 使用 search API
        if (platform === 'github') {
          const res = await fetch(
            `https://api.github.com/search/code?q=filename:${encodeURIComponent(filename)}+repo:${owner}/${repo}`,
            {
              headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'presales-agent',
              },
            }
          )

          if (!res.ok) {
            return { error: `搜索失败: ${res.status}`, files: [] }
          }

          const data = await res.json()
          const files = (data.items || [])
            .map((item: { path: string }) => item.path)
            .slice(0, 20)

          return { files, total: files.length }
        }

        return { error: '暂不支持该平台', files: [] }
      } catch (e) {
        return { error: `搜索失败: ${e instanceof Error ? e.message : '未知错误'}`, files: [] }
      }
    },
  })

  return {
    getRepoTree,
    readFile,
    getRepoInfo,
    searchFiles,
  }
}

'use client'

import { useState, useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createProject, updateProject, type ActionResult } from '@/app/actions/projects'
import { INDUSTRIES } from '@/constants'
import type { Project } from '@/types'
import { Loader2, GitBranch, Sparkles, CheckCircle2, KeyRound, ChevronDown, HelpCircle } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface ProjectFormProps {
  project?: Project
  mode?: 'create' | 'edit'
}

interface ParsedGitData {
  name: string
  industry: string
  description: string
}

interface RepoInfo {
  platform: string
  name: string
  language: string | null
  stars: number
}

interface Branch {
  name: string
  isDefault: boolean
}

export function ProjectForm({ project, mode = 'create' }: ProjectFormProps) {
  const isEdit = mode === 'edit' && project

  // Git URL 解析相关状态
  const [gitUrl, setGitUrl] = useState('')
  const [gitToken, setGitToken] = useState('')
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsedData, setParsedData] = useState<ParsedGitData | null>(null)
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null)

  // 分支选择相关状态
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [isFetchingBranches, setIsFetchingBranches] = useState(false)
  const [showBranchSelect, setShowBranchSelect] = useState(false)

  // 表单字段状态（用于 AI 填充后的受控组件）
  const [formValues, setFormValues] = useState({
    name: project?.name || '',
    industry: project?.industry || '',
    description: project?.description || '',
  })

  const action = isEdit
    ? async (_state: ActionResult | null, formData: FormData) => {
        return await updateProject(project.id, formData)
      }
    : async (_state: ActionResult | null, formData: FormData) => {
        return await createProject(formData)
      }

  const [state, formAction, isPending] = useActionState(action, null)

  // 获取分支列表
  const fetchBranches = async () => {
    if (!gitUrl.trim()) {
      setParseError('请输入 Git 仓库地址')
      return
    }

    setIsFetchingBranches(true)
    setParseError(null)
    setBranches([])
    setSelectedBranch('')
    setShowBranchSelect(false)
    setParsedData(null)
    setRepoInfo(null)

    try {
      const res = await fetch('/api/git-branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: gitUrl, token: gitToken || undefined }),
      })

      const result = await res.json()

      if (!result.success) {
        setParseError(result.error || '获取分支失败')
        return
      }

      const branchList: Branch[] = result.branches
      setBranches(branchList)

      if (branchList.length === 0) {
        setParseError('未找到任何分支')
        return
      }

      // 如果只有一个分支，直接使用该分支进行解析
      if (branchList.length === 1) {
        setSelectedBranch(branchList[0].name)
        await parseWithBranch(branchList[0].name)
      } else {
        // 多个分支，显示选择器，默认选中默认分支
        const defaultBranch = branchList.find(b => b.isDefault)?.name || branchList[0].name
        setSelectedBranch(defaultBranch)
        setShowBranchSelect(true)
      }
    } catch (error) {
      setParseError(error instanceof Error ? error.message : '网络错误，请重试')
    } finally {
      setIsFetchingBranches(false)
    }
  }

  // 使用指定分支解析仓库
  const parseWithBranch = async (branch: string) => {
    setIsParsing(true)
    setParseError(null)

    try {
      const res = await fetch('/api/parse-git-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: gitUrl, token: gitToken || undefined, branch }),
      })

      const result = await res.json()

      if (!result.success) {
        setParseError(result.error || '解析失败')
        return
      }

      // 更新表单值
      setParsedData(result.data)
      setRepoInfo(result.repoInfo)
      setShowBranchSelect(false)
      setFormValues({
        name: result.data.name,
        industry: result.data.industry,
        description: result.data.description,
      })
    } catch (error) {
      setParseError(error instanceof Error ? error.message : '网络错误，请重试')
    } finally {
      setIsParsing(false)
    }
  }

  // 解析 Git 仓库（入口函数）
  const handleParseGitRepo = async () => {
    await fetchBranches()
  }

  // 确认选择分支并解析
  const handleConfirmBranch = async () => {
    if (selectedBranch) {
      await parseWithBranch(selectedBranch)
    }
  }

  // 处理表单字段变化
  const handleFieldChange = (field: keyof typeof formValues, value: string) => {
    setFormValues(prev => ({ ...prev, [field]: value }))
  }

  // 重置表单
  const handleReset = () => {
    setFormValues({
      name: project?.name || '',
      industry: project?.industry || '',
      description: project?.description || '',
    })
    setGitUrl('')
    setGitToken('')
    setShowTokenInput(false)
    setParsedData(null)
    setRepoInfo(null)
    setParseError(null)
    setBranches([])
    setSelectedBranch('')
    setShowBranchSelect(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? '编辑项目' : '新建项目'}</CardTitle>
        <CardDescription>
          {isEdit ? '修改项目基本信息' : '填写项目基本信息以开始估算'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Git 仓库解析（仅新建时显示） */}
        {!isEdit && (
          <div className="space-y-3 rounded-lg border border-dashed p-4 bg-muted/30">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitBranch className="h-4 w-4" />
              <span>从 Git 仓库导入（可选）</span>
            </div>
            <p className="text-xs text-muted-foreground">
              输入 GitHub、GitLab 或 Gitee 仓库地址，AI 将自动分析并填充项目信息
            </p>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="https://github.com/user/repo"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  disabled={isParsing}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleParseGitRepo}
                  disabled={isParsing || isFetchingBranches || !gitUrl.trim()}
                >
                  {isFetchingBranches ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      获取分支
                    </>
                  ) : isParsing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      解析中
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      AI 解析
                    </>
                  )}
                </Button>
              </div>

              {/* Token 输入（可折叠） */}
              <Collapsible open={showTokenInput} onOpenChange={setShowTokenInput}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <KeyRound className="h-3 w-3" />
                    <span>私有仓库？添加 Access Token</span>
                    <ChevronDown className={`h-3 w-3 transition-transform ${showTokenInput ? 'rotate-180' : ''}`} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="flex gap-2 items-center">
                    <Input
                      type="password"
                      placeholder="GitLab/GitHub Personal Access Token"
                      value={gitToken}
                      onChange={(e) => setGitToken(e.target.value)}
                      disabled={isParsing}
                      className="text-sm flex-1"
                    />
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <HelpCircle className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>如何获取 GitLab Access Token</DialogTitle>
                          <DialogDescription>
                            按照以下步骤获取用于访问私有仓库的 Token
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 text-sm">
                          <div className="space-y-2">
                            <p className="font-medium">1. 登录 GitLab</p>
                            <p className="text-muted-foreground">访问你的 GitLab 实例并登录账号</p>
                          </div>
                          <div className="space-y-2">
                            <p className="font-medium">2. 进入设置页面</p>
                            <p className="text-muted-foreground">
                              点击右上角头像 → <span className="font-mono bg-muted px-1 rounded">Preferences</span> 或 <span className="font-mono bg-muted px-1 rounded">Settings</span>
                            </p>
                          </div>
                          <div className="space-y-2">
                            <p className="font-medium">3. 找到 Access Tokens</p>
                            <p className="text-muted-foreground">
                              左侧菜单 → <span className="font-mono bg-muted px-1 rounded">Access Tokens</span>
                            </p>
                          </div>
                          <div className="space-y-2">
                            <p className="font-medium">4. 创建新 Token</p>
                            <ul className="text-muted-foreground list-disc list-inside space-y-1">
                              <li>Token name: 自定义名称</li>
                              <li>Expiration date: 选择过期日期</li>
                              <li>Scopes: 勾选 <span className="font-mono bg-muted px-1 rounded">read_repository</span></li>
                            </ul>
                          </div>
                          <div className="space-y-2">
                            <p className="font-medium">5. 复制 Token</p>
                            <p className="text-muted-foreground">
                              点击创建后，<span className="text-orange-600 font-medium">立即复制</span> Token（只显示一次）
                            </p>
                          </div>
                          <div className="rounded-md bg-amber-50 p-3 text-amber-800 text-xs">
                            Token 格式类似：<span className="font-mono">glpat-xxxxxxxxxxxxxxxxxxxx</span>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    GitLab 需要 read_repository 权限的 Token
                  </p>
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* 分支选择器 */}
            {showBranchSelect && branches.length > 1 && (
              <div className="rounded-md bg-blue-50 p-3 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                  <GitBranch className="h-4 w-4" />
                  <span>选择要分析的分支</span>
                </div>
                <div className="flex gap-2">
                  <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                    <SelectTrigger className="flex-1 bg-white">
                      <SelectValue placeholder="选择分支" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch.name} value={branch.name}>
                          {branch.name}
                          {branch.isDefault && (
                            <span className="ml-2 text-xs text-muted-foreground">(默认)</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    onClick={handleConfirmBranch}
                    disabled={!selectedBranch || isParsing}
                  >
                    {isParsing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        解析中
                      </>
                    ) : (
                      '确认'
                    )}
                  </Button>
                </div>
                <p className="text-xs text-blue-600">
                  发现 {branches.length} 个分支，请选择要分析的分支
                </p>
              </div>
            )}

            {/* 解析错误 */}
            {parseError && (
              <div className="rounded-md bg-red-50 p-2 text-sm text-red-600">
                {parseError}
              </div>
            )}

            {/* 解析成功提示 */}
            {parsedData && repoInfo && (
              <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">已从仓库导入信息</div>
                  <div className="text-xs text-green-600 mt-1">
                    {repoInfo.platform.toUpperCase()} · {repoInfo.name}
                    {repoInfo.language && ` · ${repoInfo.language}`}
                    {repoInfo.stars > 0 && ` · ${repoInfo.stars} stars`}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <form action={formAction} className="space-y-6">
          {/* 项目名称 */}
          <div className="space-y-2">
            <Label htmlFor="name">
              项目名称 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              placeholder="输入项目名称"
              value={formValues.name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              required
            />
          </div>

          {/* 行业选择 */}
          <div className="space-y-2">
            <Label htmlFor="industry">所属行业</Label>
            <Select
              name="industry"
              value={formValues.industry}
              onValueChange={(value) => handleFieldChange('industry', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择行业" />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((industry) => (
                  <SelectItem key={industry} value={industry}>
                    {industry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 项目描述 */}
          <div className="space-y-2">
            <Label htmlFor="description">项目描述</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="简要描述项目背景和目标..."
              rows={4}
              value={formValues.description}
              onChange={(e) => handleFieldChange('description', e.target.value)}
            />
          </div>

          {/* 错误提示 */}
          {state?.error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {state.error}
            </div>
          )}

          {/* 提交按钮 */}
          <div className="flex gap-4">
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? '保存修改' : '创建项目'}
            </Button>
            {!isEdit && (
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={handleReset}
              >
                重置
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

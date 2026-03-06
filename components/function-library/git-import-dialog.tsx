'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  GitBranch,
  Loader2,
  Sparkles,
  KeyRound,
  ChevronDown,
  CheckCircle2,
  Clock,
  Trash2,
  Pencil,
  FolderOpen,
  HelpCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { batchImportFunctions } from '@/app/actions/git-import-functions'

interface Branch {
  name: string
  isDefault: boolean
}

interface ParsedFunction {
  function_name: string
  category: string
  description: string
  standard_hours: number
  selected: boolean
}

interface ParsedGroup {
  name: string
  description: string
  function_names: string[]
  selected: boolean
}

type Phase = 'input' | 'analyzing' | 'preview'

interface ProgressEvent {
  message: string
  tool?: string
  args?: Record<string, unknown>
}

export function GitImportDialog({ children, categories = [] }: { children: ReactNode; categories?: string[] }) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('input')

  // Git 输入状态
  const [gitUrl, setGitUrl] = useState('')
  const [gitToken, setGitToken] = useState('')
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [showBranchSelect, setShowBranchSelect] = useState(false)
  const [isFetchingBranches, setIsFetchingBranches] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  // 分析进度状态（真实事件流）
  const [progressEvents, setProgressEvents] = useState<ProgressEvent[]>([])
  const [currentMessage, setCurrentMessage] = useState('')

  // 预览状态
  const [functions, setFunctions] = useState<ParsedFunction[]>([])
  const [groups, setGroups] = useState<ParsedGroup[]>([])
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const resetState = () => {
    setPhase('input')
    setGitUrl('')
    setGitToken('')
    setShowTokenInput(false)
    setBranches([])
    setSelectedBranch('')
    setShowBranchSelect(false)
    setIsFetchingBranches(false)
    setParseError(null)
    setProgressEvents([])
    setCurrentMessage('')
    setFunctions([])
    setGroups([])
    setEditingIndex(null)
    setIsImporting(false)
  }

  // 获取分支并开始分析
  const handleStartAnalysis = async () => {
    if (!gitUrl.trim()) return
    setParseError(null)
    setIsFetchingBranches(true)

    try {
      const res = await fetch('/api/git-branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: gitUrl.trim(), token: gitToken || undefined }),
      })
      const data = await res.json()

      if (!data.success) {
        setParseError(data.error || '获取分支失败')
        setIsFetchingBranches(false)
        return
      }

      setBranches(data.branches || [])

      if (data.branches.length <= 1) {
        // 单分支，直接开始分析
        const branch = data.defaultBranch || data.branches[0]?.name
        setSelectedBranch(branch || '')
        setIsFetchingBranches(false)
        await startParsing(branch)
      } else {
        // 多分支，显示选择器
        setSelectedBranch(data.defaultBranch || '')
        setShowBranchSelect(true)
        setIsFetchingBranches(false)
      }
    } catch {
      setParseError('获取分支失败，请检查网络连接')
      setIsFetchingBranches(false)
    }
  }

  const handleConfirmBranch = async () => {
    if (!selectedBranch) return
    setShowBranchSelect(false)
    await startParsing(selectedBranch)
  }

  // 调用 AI 分析 API（SSE 流式读取）
  const startParsing = async (branch?: string) => {
    setPhase('analyzing')
    setParseError(null)
    setProgressEvents([])
    setCurrentMessage('正在连接仓库...')

    try {
      const res = await fetch('/api/parse-git-functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: gitUrl.trim(),
          token: gitToken || undefined,
          branch: branch || undefined,
        }),
      })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null)
        setParseError(data?.error || `请求失败: ${res.status}`)
        setPhase('input')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 解析 SSE 事件（以 data: 开头，以 \n\n 结尾）
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || '' // 最后一段可能不完整，留到下次

        for (const line of lines) {
          const dataLine = line.trim()
          if (!dataLine.startsWith('data: ')) continue
          try {
            const event = JSON.parse(dataLine.slice(6))

            if (event.type === 'progress') {
              setCurrentMessage(event.message)
              setProgressEvents((prev) => [
                ...prev,
                { message: event.message, tool: event.tool, args: event.args },
              ])
            } else if (event.type === 'thinking') {
              setCurrentMessage(event.message)
            } else if (event.type === 'result' && event.success) {
              setFunctions(
                (event.data.functions || []).map((f: Omit<ParsedFunction, 'selected'>) => ({
                  ...f,
                  selected: true,
                }))
              )
              setGroups(
                (event.data.groups || []).map((g: Omit<ParsedGroup, 'selected'>) => ({
                  ...g,
                  selected: true,
                }))
              )
              setPhase('preview')
            } else if (event.type === 'error') {
              setParseError(event.error || 'AI 分析失败')
              setPhase('input')
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      // 如果流结束但没有收到 result 或 error，检查状态
      if (phase === 'analyzing') {
        // 可能流异常中断
        setParseError('分析过程意外中断，请重试')
        setPhase('input')
      }
    } catch {
      setParseError('分析失败，请检查网络连接后重试')
      setPhase('input')
    }
  }

  // 功能选择操作
  const toggleFunction = (index: number) => {
    setFunctions((prev) =>
      prev.map((f, i) => (i === index ? { ...f, selected: !f.selected } : f))
    )
  }

  const toggleAllFunctions = (selected: boolean) => {
    setFunctions((prev) => prev.map((f) => ({ ...f, selected })))
  }

  const removeFunction = (index: number) => {
    const removedName = functions[index].function_name
    setFunctions((prev) => prev.filter((_, i) => i !== index))
    // 同时从功能组中移除
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        function_names: g.function_names.filter((n) => n !== removedName),
      }))
    )
  }

  const updateFunction = (index: number, updates: Partial<ParsedFunction>) => {
    setFunctions((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f))
    )
  }

  // 功能组操作
  const toggleGroup = (index: number) => {
    setGroups((prev) =>
      prev.map((g, i) => (i === index ? { ...g, selected: !g.selected } : g))
    )
  }

  // 确认导入
  const handleImport = async () => {
    const selectedFunctions = functions.filter((f) => f.selected)
    if (selectedFunctions.length === 0) {
      toast.error('请至少选择一个功能')
      return
    }

    setIsImporting(true)

    const selectedFunctionNames = new Set(selectedFunctions.map((f) => f.function_name))
    const selectedGroups = groups
      .filter((g) => g.selected)
      .map((g) => ({
        ...g,
        // 只保留被选中的功能
        function_names: g.function_names.filter((n) => selectedFunctionNames.has(n)),
      }))
      .filter((g) => g.function_names.length > 0)

    const result = await batchImportFunctions({
      functions: selectedFunctions.map(({ function_name, category, description, standard_hours }) => ({
        function_name,
        category,
        description,
        standard_hours,
      })),
      groups: selectedGroups.map(({ name, description, function_names }) => ({
        name,
        description,
        function_names,
      })),
    })

    setIsImporting(false)

    if (result.success) {
      toast.success(
        `导入成功：${result.functionCount} 个功能${result.groupCount ? `，${result.groupCount} 个功能组` : ''}`
      )
      setOpen(false)
      resetState()
    } else {
      toast.error(result.error || '导入失败')
    }
  }

  const progressEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    progressEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [progressEvents])

  const selectedCount = functions.filter((f) => f.selected).length
  const totalHours = functions
    .filter((f) => f.selected)
    .reduce((sum, f) => sum + f.standard_hours, 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (!value) resetState()
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className={phase === 'preview' ? 'max-w-5xl max-h-[90vh]' : 'max-w-[800px]'}>
        <DialogHeader>
          <DialogTitle>
            {phase === 'preview' ? '预览导入结果' : '从 Git 仓库导入功能'}
          </DialogTitle>
          <DialogDescription>
            {phase === 'preview'
              ? '检查 AI 分析结果，编辑后确认导入'
              : '输入 Git 仓库地址，AI 将分析代码并提取业务功能模块'}
          </DialogDescription>
        </DialogHeader>

        {/* 阶段一：Git 仓库输入 */}
        {(phase === 'input' || phase === 'analyzing') && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="https://github.com/user/repo"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  disabled={phase === 'analyzing' || isFetchingBranches}
                  className="flex-1"
                />
                <Button
                  type="button"
                  onClick={handleStartAnalysis}
                  disabled={phase === 'analyzing' || isFetchingBranches || !gitUrl.trim()}
                >
                  {isFetchingBranches ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      获取分支
                    </>
                  ) : phase === 'analyzing' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      AI 分析中
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      开始分析
                    </>
                  )}
                </Button>
              </div>

              {/* Token 输入 */}
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
                      disabled={phase === 'analyzing'}
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
                          <DialogTitle>如何获取 Access Token</DialogTitle>
                          <DialogDescription>
                            按照以下步骤获取用于访问私有仓库的 Token
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 text-sm">
                          <div className="space-y-2">
                            <p className="font-medium">GitLab</p>
                            <ol className="text-muted-foreground list-decimal list-inside space-y-1">
                              <li>点击右上角头像 → <span className="font-mono bg-muted px-1 rounded">Preferences</span></li>
                              <li>左侧菜单 → <span className="font-mono bg-muted px-1 rounded">Access Tokens</span></li>
                              <li>创建新 Token，Scopes 勾选 <span className="font-mono bg-muted px-1 rounded">read_api</span></li>
                              <li>点击创建后<span className="text-orange-600 font-medium">立即复制</span>（只显示一次）</li>
                            </ol>
                          </div>
                          <div className="space-y-2">
                            <p className="font-medium">GitHub</p>
                            <ol className="text-muted-foreground list-decimal list-inside space-y-1">
                              <li>Settings → Developer settings → Personal access tokens</li>
                              <li>Generate new token (classic)</li>
                              <li>勾选 <span className="font-mono bg-muted px-1 rounded">repo</span> 权限</li>
                            </ol>
                          </div>
                          <div className="rounded-md bg-amber-50 p-3 text-amber-800 text-xs space-y-1">
                            <p><span className="font-medium">注意：</span>GitLab 的 <span className="font-mono">read_repository</span> 仅支持 Git 克隆，REST API 需要 <span className="font-mono">read_api</span> 权限。</p>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    GitLab 需要 read_api 权限的 Token
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
                  <Button onClick={handleConfirmBranch} disabled={!selectedBranch}>
                    确认
                  </Button>
                </div>
              </div>
            )}

            {/* 分析进度提示 */}
            {phase === 'analyzing' && (
              <div className="rounded-md bg-blue-50 p-4 space-y-3">
                {/* 当前状态 */}
                <div className="flex items-start gap-2 text-sm font-medium text-blue-700 min-w-0">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />
                  <span className="wrap-break-word min-w-0">{currentMessage}</span>
                </div>
                {/* 已完成的操作日志 */}
                {progressEvents.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {progressEvents.map((evt, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs text-blue-600">
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-blue-400" />
                        <span className="truncate">{evt.message}</span>
                      </div>
                    ))}
                    <div ref={progressEndRef} />
                  </div>
                )}
                <div className="text-[10px] text-blue-500">
                  已执行 {progressEvents.length} 步操作
                </div>
              </div>
            )}

            {/* 错误提示 */}
            {parseError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
                {parseError}
              </div>
            )}
          </div>
        )}

        {/* 阶段二：预览结果 */}
        {phase === 'preview' && (
          <div className="space-y-4">
            {/* 汇总信息 */}
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>已选 {selectedCount}/{functions.length} 个功能</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>总工时 {totalHours.toFixed(0)} 小时</span>
              </div>
              <div className="flex items-center gap-1">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <span>{groups.filter((g) => g.selected).length} 个功能组</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {/* 左侧：功能列表 */}
              <div className="col-span-2 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">功能列表</h4>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleAllFunctions(true)}
                    >
                      全选
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleAllFunctions(false)}
                    >
                      取消全选
                    </Button>
                  </div>
                </div>

                <ScrollArea className="h-[50vh]">
                  <div className="space-y-2 pr-4">
                    {/* 按分类分组展示 */}
                    {Object.entries(
                      functions.reduce(
                        (acc, f, i) => {
                          if (!acc[f.category]) acc[f.category] = []
                          acc[f.category].push({ ...f, _index: i })
                          return acc
                        },
                        {} as Record<string, (ParsedFunction & { _index: number })[]>
                      )
                    ).map(([category, items]) => (
                      <div key={category} className="space-y-1">
                        <div className="flex items-center gap-2 py-1">
                          <Badge variant="secondary" className="text-xs">
                            {category}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {items.filter((i) => i.selected).length}/{items.length}
                          </span>
                        </div>
                        {items.map((item) => (
                          <FunctionRow
                            key={item._index}
                            item={item}
                            index={item._index}
                            isEditing={editingIndex === item._index}
                            categories={categories}
                            onToggle={() => toggleFunction(item._index)}
                            onRemove={() => removeFunction(item._index)}
                            onEdit={() =>
                              setEditingIndex(
                                editingIndex === item._index ? null : item._index
                              )
                            }
                            onUpdate={(updates) => updateFunction(item._index, updates)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* 右侧：功能组 */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium">功能组</h4>
                <ScrollArea className="h-[50vh]">
                  <div className="space-y-3 pr-4">
                    {groups.map((group, index) => {
                      const selectedFunctionNames = new Set(
                        functions.filter((f) => f.selected).map((f) => f.function_name)
                      )
                      const validCount = group.function_names.filter((n) =>
                        selectedFunctionNames.has(n)
                      ).length

                      return (
                        <div
                          key={index}
                          className={`rounded-lg border p-3 space-y-2 ${group.selected ? 'border-primary/30 bg-primary/5' : 'opacity-60'
                            }`}
                        >
                          <div className="flex items-start gap-2">
                            <Checkbox
                              checked={group.selected}
                              onCheckedChange={() => toggleGroup(index)}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">
                                {group.name}
                              </div>
                              <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                {group.description}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {validCount} 个功能
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {group.function_names
                                  .filter((n) => selectedFunctionNames.has(n))
                                  .slice(0, 5)
                                  .map((name) => (
                                    <Badge
                                      key={name}
                                      variant="outline"
                                      className="text-[10px] px-1 py-0"
                                    >
                                      {name}
                                    </Badge>
                                  ))}
                                {validCount > 5 && (
                                  <span className="text-[10px] text-muted-foreground">
                                    +{validCount - 5}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {groups.length === 0 && (
                      <div className="text-sm text-muted-foreground text-center py-4">
                        AI 未生成功能组建议
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* 底部操作栏 */}
            <div className="flex items-center justify-between pt-2 border-t">
              <Button variant="outline" onClick={() => { setPhase('input'); setParseError(null) }}>
                重新分析
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setOpen(false); resetState() }}>
                  取消
                </Button>
                <Button onClick={handleImport} disabled={isImporting || selectedCount === 0}>
                  {isImporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      导入中
                    </>
                  ) : (
                    `确认导入 (${selectedCount} 个功能)`
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * 单个功能行组件
 */
function FunctionRow({
  item,
  index,
  isEditing,
  categories,
  onToggle,
  onRemove,
  onEdit,
  onUpdate,
}: {
  item: ParsedFunction
  index: number
  isEditing: boolean
  categories: string[]
  onToggle: () => void
  onRemove: () => void
  onEdit: () => void
  onUpdate: (updates: Partial<ParsedFunction>) => void
}) {
  return (
    <div
      className={`rounded-md border p-2 text-sm ${item.selected ? '' : 'opacity-50'
        }`}
    >
      <div className="flex items-start gap-2">
        <Checkbox
          checked={item.selected}
          onCheckedChange={onToggle}
          className="mt-1"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-medium truncate">{item.function_name}</span>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <Badge variant="outline" className="text-xs font-mono">
                {item.standard_hours}h
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onEdit}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive"
                onClick={onRemove}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
            {item.description}
          </div>
        </div>
      </div>

      {/* 编辑模式 */}
      {isEditing && (
        <div className="mt-2 pt-2 border-t space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">功能名称</label>
              <Input
                value={item.function_name}
                onChange={(e) => onUpdate({ function_name: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">分类</label>
              <Select
                value={item.category}
                onValueChange={(value) => onUpdate({ category: value })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">描述</label>
            <Input
              value={item.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              className="h-8 text-sm"
            />
          </div>
          <div className="w-32">
            <label className="text-xs text-muted-foreground">标准工时 (h)</label>
            <Input
              type="number"
              min={0.5}
              step={0.5}
              value={item.standard_hours}
              onChange={(e) =>
                onUpdate({ standard_hours: parseFloat(e.target.value) || 0 })
              }
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}
    </div>
  )
}

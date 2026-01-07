'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProjectCard } from './project-card'
import { Search, X, FolderKanban } from 'lucide-react'
import type { Project, ProjectStatus } from '@/types'
import { INDUSTRIES } from '@/constants'

interface ProjectListProps {
  projects: Project[]
  total: number
  page: number
  pageSize: number
}

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'draft', label: '草稿' },
  { value: 'analyzing', label: '分析中' },
  { value: 'completed', label: '已完成' },
  { value: 'archived', label: '已归档' },
]

export function ProjectList({ projects, total, page, pageSize }: ProjectListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [status, setStatus] = useState<string>(searchParams.get('status') || 'all')
  const [industry, setIndustry] = useState<string>(searchParams.get('industry') || 'all')

  const totalPages = Math.ceil(total / pageSize)

  const updateFilters = (newParams: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString())

    Object.entries(newParams).forEach(([key, value]) => {
      if (value && value !== 'all') {
        params.set(key, value)
      } else {
        params.delete(key)
      }
    })

    // 切换筛选条件时重置到第一页
    if (!newParams.page) {
      params.delete('page')
    }

    startTransition(() => {
      router.push(`/projects?${params.toString()}`)
    })
  }

  const handleSearch = () => {
    updateFilters({ search })
  }

  const handleClearSearch = () => {
    setSearch('')
    updateFilters({ search: '' })
  }

  const handleStatusChange = (value: string) => {
    setStatus(value)
    updateFilters({ status: value })
  }

  const handleIndustryChange = (value: string) => {
    setIndustry(value)
    updateFilters({ industry: value })
  }

  const handlePageChange = (newPage: number) => {
    updateFilters({ page: newPage.toString() })
  }

  return (
    <div className="space-y-6">
      {/* 筛选区域 */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索项目名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="pl-10 pr-10"
          />
          {search && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={industry} onValueChange={handleIndustryChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="行业" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部行业</SelectItem>
              {INDUSTRIES.map((ind) => (
                <SelectItem key={ind} value={ind}>
                  {ind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleSearch} disabled={isPending}>
            搜索
          </Button>
        </div>
      </div>

      {/* 项目列表 */}
      {projects.length === 0 ? (
        <div className="text-center py-16">
          <FolderKanban className="mx-auto h-16 w-16 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">暂无项目</h3>
          <p className="text-muted-foreground mb-4">
            {search || status !== 'all' || industry !== 'all'
              ? '没有找到符合条件的项目'
              : '点击"新建项目"开始您的第一个估算'}
          </p>
          {(search || status !== 'all' || industry !== 'all') && (
            <Button
              variant="outline"
              onClick={() => {
                setSearch('')
                setStatus('all')
                setIndustry('all')
                router.push('/projects')
              }}
            >
              清除筛选条件
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                共 {total} 个项目，第 {page} / {totalPages} 页
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || isPending}
                  onClick={() => handlePageChange(page - 1)}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || isPending}
                  onClick={() => handlePageChange(page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

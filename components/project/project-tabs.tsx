'use client'

import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  FileText,
  Sparkles,
  Layers,
  Calculator,
  FileOutput,
} from 'lucide-react'

const tabs = [
  { segment: null, label: '需求输入', icon: FileText },         // /projects/[id]
  { segment: 'analysis', label: 'AI 分析', icon: Sparkles },    // /projects/[id]/analysis
  { segment: 'functions', label: '功能明细', icon: Layers },    // /projects/[id]/functions
  { segment: 'estimation', label: '成本估算', icon: Calculator }, // /projects/[id]/estimation
  { segment: 'report', label: '报告预览', icon: FileOutput },   // /projects/[id]/report
]

interface ProjectTabsProps {
  projectId: string
}

export function ProjectTabs({ projectId }: ProjectTabsProps) {
  // 获取当前活动的子路由段，比 usePathname 更简洁
  const segment = useSelectedLayoutSegment()

  return (
    <Tabs value={segment ?? '__root__'} className="w-full">
      <TabsList className="grid w-full grid-cols-5">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.segment ?? '__root__'}
            value={tab.segment ?? '__root__'}
            asChild
          >
            <Link
              href={`/projects/${projectId}${tab.segment ? `/${tab.segment}` : ''}`}
              className="flex items-center gap-2"
            >
              <tab.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

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
  { segment: null, label: '需求工作台', icon: FileText },
  { segment: 'analysis', label: '方案与成本分析', icon: Sparkles },
  { segment: 'functions', label: '功能明细', icon: Layers },
  { segment: 'estimation', label: '成本估算', icon: Calculator },
  { segment: 'report', label: '报告预览', icon: FileOutput },
]

interface ProjectTabsProps {
  projectId: string
}

export function ProjectTabs({ projectId }: ProjectTabsProps) {
  // 获取当前活动的子路由段，比 usePathname 更简洁
  const segment = useSelectedLayoutSegment()

  const selectedValue = segment === 'meetings' ? '__root__' : segment ?? '__root__'

  return (
    <Tabs value={selectedValue} className="w-full">
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

import {
  LayoutDashboard,
  FolderKanban,
  Library,
  FileText,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
  description?: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const mainNavigation: NavItem[] = [
  {
    title: '仪表盘',
    href: '/dashboard',
    icon: LayoutDashboard,
    description: '概览和统计数据',
  },
  {
    title: '项目管理',
    href: '/projects',
    icon: FolderKanban,
    description: '管理估算项目',
  },
  {
    title: '功能库',
    href: '/function-library',
    icon: Library,
    description: '功能模块库',
  },
  {
    title: '模板管理',
    href: '/templates',
    icon: FileText,
    description: '管理提示词模板',
  },
  {
    title: '系统设置',
    href: '/settings',
    icon: Settings,
    description: '系统配置',
  },
]

export const siteConfig = {
  name: '售前成本估算系统',
  description: 'AI 驱动的售前成本估算助手',
  version: '1.0.0',
}

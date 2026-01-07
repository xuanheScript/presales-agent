'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { mainNavigation, siteConfig } from '@/constants/navigation'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Menu } from 'lucide-react'
import { useState } from 'react'

interface SidebarProps {
  className?: string
}

function SidebarContent() {
  const pathname = usePathname()

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center h-16 px-6 border-b">
        <Link href="/dashboard" className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">PE</span>
          </div>
          <span className="font-semibold text-lg">{siteConfig.name}</span>
        </Link>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-1">
          {mainNavigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <Icon className="h-5 w-5" />
                {item.title}
              </Link>
            )
          })}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="p-4 border-t">
        <p className="text-xs text-gray-500 text-center">
          v{siteConfig.version}
        </p>
      </div>
    </div>
  )
}

export function Sidebar({ className }: SidebarProps) {
  return (
    <aside
      className={cn(
        'hidden lg:flex lg:flex-col lg:w-64 lg:border-r lg:bg-white',
        className
      )}
    >
      <SidebarContent />
    </aside>
  )
}

export function MobileSidebar() {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">打开菜单</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-64">
        <SidebarContent />
      </SheetContent>
    </Sheet>
  )
}

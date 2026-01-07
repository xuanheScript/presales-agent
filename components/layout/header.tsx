'use client'

import { signOut } from '@/app/actions/auth'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MobileSidebar } from './sidebar'
import { LogOut, User, Settings } from 'lucide-react'
import Link from 'next/link'

interface HeaderProps {
  user: {
    email?: string
    user_metadata?: {
      full_name?: string
      avatar_url?: string
    }
  } | null
}

export function Header({ user }: HeaderProps) {
  const fullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '用户'
  const avatarUrl = user?.user_metadata?.avatar_url
  const initials = fullName.slice(0, 2).toUpperCase()

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b bg-white px-4 lg:px-6">
      <MobileSidebar />

      <div className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-9 w-9 rounded-full">
            <Avatar className="h-9 w-9">
              <AvatarImage src={avatarUrl} alt={fullName} />
              <AvatarFallback className="bg-blue-100 text-blue-700">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" forceMount>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{fullName}</p>
              <p className="text-xs leading-none text-muted-foreground">
                {user?.email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings" className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              <span>设置</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer text-red-600 focus:text-red-600"
            onSelect={async () => {
              await signOut()
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>退出登录</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}

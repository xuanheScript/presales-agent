import type { Metadata } from 'next'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: '售前成本估算系统',
  description: 'AI 驱动的售前成本估算助手',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  )
}

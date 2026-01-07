import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // 如果已登录，重定向到仪表盘
  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-white">
      <main className="flex flex-col items-center text-center px-4">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-8">
          <span className="text-white font-bold text-2xl">PE</span>
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl mb-4">
          售前成本估算系统
        </h1>

        <p className="text-lg text-gray-600 max-w-md mb-8">
          AI 驱动的智能售前成本估算助手，帮助您快速准确地进行项目报价
        </p>

        <div className="flex gap-4">
          <Button asChild size="lg">
            <Link href="/login">登录</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/register">注册</Link>
          </Button>
        </div>

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-3xl">
          <div className="text-center">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">智能需求分析</h3>
            <p className="text-sm text-gray-600">AI 自动分析需求文档，提取关键功能点</p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">精准工时估算</h3>
            <p className="text-sm text-gray-600">基于功能库标准工时，智能计算项目周期</p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">自动成本报告</h3>
            <p className="text-sm text-gray-600">一键生成专业的成本估算报告</p>
          </div>
        </div>
      </main>
    </div>
  )
}

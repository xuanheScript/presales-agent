/**
 * Next.js Instrumentation
 *
 * 这个文件会在 Next.js 应用启动时自动执行
 * 用于初始化 OpenTelemetry 和 Langfuse
 *
 * 文档: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  // 只在服务端运行
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initLangfuse } = await import('@/lib/observability/langfuse')
    initLangfuse()
  }
}

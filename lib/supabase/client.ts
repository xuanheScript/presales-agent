import { createBrowserClient } from '@supabase/ssr'

// 声明运行时配置的类型
declare global {
  interface Window {
    __RUNTIME_CONFIG__?: {
      SUPABASE_URL?: string
      SUPABASE_ANON_KEY?: string
    }
  }
}

/**
 * 获取运行时配置
 * 从服务端注入的运行时配置读取
 */
function getRuntimeConfig() {
  if (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) {
    return {
      url: window.__RUNTIME_CONFIG__.SUPABASE_URL!,
      anonKey: window.__RUNTIME_CONFIG__.SUPABASE_ANON_KEY!,
    }
  }

  throw new Error('Runtime config not available. Make sure the page is rendered from the server.')
}

export function createClient() {
  const config = getRuntimeConfig()
  return createBrowserClient(config.url, config.anonKey)
}

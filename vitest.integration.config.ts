import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})

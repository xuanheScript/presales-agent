import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    name: 'unit',
    environment: 'node',
    include: [
      'lib/**/*.test.ts',
      'app/**/*.test.ts',
      'components/**/*.test.ts',
      'tests/unit/**/*.test.ts',
    ],
    exclude: ['tests/integration/**', 'e2e/**'],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 5_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage/unit',
      include: [
        'lib/agents/execution-policy.ts',
        'lib/agents/execution-errors.ts',
        'lib/agents/persistence-snapshot.ts',
        'lib/agents/sse-protocol.ts',
        'lib/ai/embedding.ts',
        'lib/domain/costing/**/*.ts',
      ],
      exclude: ['**/__tests__/**', '**/*.test.ts', '**/index.ts', '**/types.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
})

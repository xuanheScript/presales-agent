import { defineConfig } from '@trigger.dev/sdk'

const project = process.env.TRIGGER_PROJECT_REF
if (!project) {
  throw new Error('TRIGGER_PROJECT_REF 未配置')
}

export default defineConfig({
  project,
  dirs: ['./trigger'],
  maxDuration: 14_400,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 5_000,
      maxTimeoutInMs: 60_000,
      factor: 2,
      randomize: true,
    },
  },
})

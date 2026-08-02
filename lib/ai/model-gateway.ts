import type { LanguageModel } from 'ai'
import { defaultModel } from './config'

export interface ModelGateway {
  readonly model: LanguageModel
  readonly maxRetries: number
}

export const defaultModelGateway: ModelGateway = {
  model: defaultModel,
  maxRetries: 1,
}

export function createModelGateway(
  model: LanguageModel,
  maxRetries = 0
): ModelGateway {
  return { model, maxRetries }
}

import type { LanguageModel } from 'ai'
import { defaultModel } from './config'
import { defaultModelProfile, type ModelProfile } from './model-profile'

export interface ModelGateway {
  readonly model: LanguageModel
  readonly maxRetries: number
  readonly profile: ModelProfile
}

export const defaultModelGateway: ModelGateway = {
  model: defaultModel,
  maxRetries: 1,
  profile: defaultModelProfile,
}

export function createModelGateway(
  model: LanguageModel,
  maxRetries = 0,
  profile: ModelProfile = defaultModelProfile
): ModelGateway {
  return { model, maxRetries, profile }
}

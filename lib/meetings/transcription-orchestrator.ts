import { wait } from '@trigger.dev/sdk'
import {
  downloadAndVerifyMeetingAudio,
  MeetingAudioIntegrityError,
} from '@/lib/meetings/audio-download'
import {
  createFunASRTranscriptionJob,
  FunASRConnectionError,
  FunASRHttpError,
  getFunASRTranscriptionJob,
  type FunASRTranscriptionJob,
} from '@/lib/meetings/funasr-client'
import {
  claimTranscriptionJob,
  commitTranscriptionJob,
  finishOrRetryTranscriptionJob,
  updateTranscriptionJobProgress,
  type ClaimedTranscriptionJob,
} from '@/lib/meetings/transcription-store'

const POLL_SECONDS = 10
const MAX_POLLS = 1_080

class ProviderTerminalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ProviderTerminalError'
  }
}

function safeMessage(error: unknown): string {
  if (
    error instanceof MeetingAudioIntegrityError
    || error instanceof FunASRConnectionError
    || error instanceof FunASRHttpError
    || error instanceof ProviderTerminalError
  ) {
    return error.message
  }
  return error instanceof Error ? error.message : '转写后台任务失败'
}

function errorCode(error: unknown): string {
  if (error instanceof MeetingAudioIntegrityError) return error.code
  if (error instanceof FunASRConnectionError) return 'FUNASR_CONNECTION_ERROR'
  if (error instanceof FunASRHttpError) return `FUNASR_HTTP_${error.status}`
  if (error instanceof ProviderTerminalError) return error.code
  return 'ORCHESTRATION_ERROR'
}

function retryable(error: unknown): boolean {
  if (error instanceof MeetingAudioIntegrityError || error instanceof ProviderTerminalError) {
    return error instanceof ProviderTerminalError && error.retryable
  }
  if (error instanceof FunASRHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500
  }
  return true
}

async function submitProviderJob(
  job: ClaimedTranscriptionJob,
  signal?: AbortSignal,
): Promise<FunASRTranscriptionJob> {
  const audio = await downloadAndVerifyMeetingAudio({
    bucket: job.bucket,
    objectPath: job.objectPath,
    expectedSizeBytes: job.sizeBytes,
    expectedSha256: job.sha256,
    signal,
  })
  try {
    await updateTranscriptionJobProgress({
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      stage: 'submitting_provider',
      progressPercent: 20,
    })
    const providerJob = await createFunASRTranscriptionJob({
      filePath: audio.path,
      filename: job.originalFilename,
      contentType: job.mimeType,
      idempotencyKey: `processing-job:${job.jobId}:attempt:${job.attempt}`,
      language: 'zh',
      hotwords: [],
      diarize: true,
      signal,
    })
    await updateTranscriptionJobProgress({
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      stage: `provider_${providerJob.stage}`,
      progressPercent: providerJob.status === 'succeeded' ? 90 : 35,
      providerTaskId: providerJob.id,
    })
    return providerJob
  } finally {
    await audio.cleanup()
  }
}

async function pollProviderJob(input: {
  initialJob: FunASRTranscriptionJob
  claimedJob: ClaimedTranscriptionJob
  signal?: AbortSignal
}): Promise<FunASRTranscriptionJob> {
  let providerJob = input.initialJob
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    if (
      providerJob.status === 'succeeded'
      || providerJob.status === 'failed'
      || providerJob.status === 'cancelled'
    ) {
      return providerJob
    }

    await updateTranscriptionJobProgress({
      jobId: input.claimedJob.jobId,
      leaseToken: input.claimedJob.leaseToken,
      stage: `provider_${providerJob.stage}`,
      progressPercent: providerJob.status === 'running' ? 60 : 40,
      providerTaskId: providerJob.id,
    })
    await wait.for({ seconds: POLL_SECONDS })
    input.signal?.throwIfAborted()
    providerJob = await getFunASRTranscriptionJob(providerJob.id, input.signal)
  }
  throw new ProviderTerminalError('FUNASR_TIMEOUT', 'FunASR 转写等待超过 3 小时', true)
}

export async function runTranscriptionOrchestration(input: {
  processingJobId: string
  workerId: string
  signal?: AbortSignal
}): Promise<{
  revisionId: string | null
  providerTaskId: string | null
  retryScheduled: boolean
  retryAt: string | null
}> {
  const claimed = await claimTranscriptionJob(input.processingJobId, input.workerId)
  if (!claimed) {
    throw new Error('转写任务不存在、已经结束或正由其他 worker 处理')
  }

  try {
    let providerJob = claimed.providerTaskId
      ? await getFunASRTranscriptionJob(claimed.providerTaskId, input.signal)
      : await submitProviderJob(claimed, input.signal)

    providerJob = await pollProviderJob({
      initialJob: providerJob,
      claimedJob: claimed,
      signal: input.signal,
    })

    if (providerJob.status !== 'succeeded' || !providerJob.result) {
      const providerError = providerJob.error
      throw new ProviderTerminalError(
        providerError?.code ?? `PROVIDER_${providerJob.status.toUpperCase()}`,
        providerError?.message ?? `FunASR 任务状态为 ${providerJob.status}`,
        providerError?.retryable ?? false,
      )
    }
    if (!providerJob.result.text.trim()) {
      throw new ProviderTerminalError('EMPTY_TRANSCRIPT', '音频未识别到可校对的语音内容', false)
    }

    await updateTranscriptionJobProgress({
      jobId: claimed.jobId,
      leaseToken: claimed.leaseToken,
      stage: 'persisting_transcript',
      progressPercent: 95,
      providerTaskId: providerJob.id,
    })
    const revisionId = await commitTranscriptionJob({
      job: claimed,
      providerTaskId: providerJob.id,
      result: providerJob.result,
      configVersion: process.env.FUNASR_CONFIG_VERSION ?? 'funasr-config-v1',
    })
    return {
      revisionId,
      providerTaskId: providerJob.id,
      retryScheduled: false,
      retryAt: null,
    }
  } catch (error) {
    const retryAfterSeconds = error instanceof FunASRHttpError
      ? error.retryAfterSeconds
      : null
    const failure = await finishOrRetryTranscriptionJob({
      jobId: claimed.jobId,
      leaseToken: claimed.leaseToken,
      errorCode: errorCode(error),
      errorMessage: safeMessage(error),
      retryable: retryable(error),
      retryAfterSeconds,
    })
    if (failure.retryScheduled) {
      return {
        revisionId: null,
        providerTaskId: claimed.providerTaskId,
        retryScheduled: true,
        retryAt: failure.nextPollAt,
      }
    }
    throw error
  }
}

import type { ProcessingJob } from '@/types'
import { markProcessingJobDispatchFailed } from '@/lib/meetings/service'

export type DispatchableMeetingJobType = Extract<
  ProcessingJob['job_type'],
  'transcription' | 'meeting_analysis'
>

export async function recoverMeetingTaskDispatchFailure(input: {
  processingJobId: string
  jobType: DispatchableMeetingJobType
  error: unknown
}): Promise<ProcessingJob['status'] | 'recovery_failed'> {
  const errorMessage = input.error instanceof Error
    ? input.error.message
    : '后台任务调度失败'

  try {
    return await markProcessingJobDispatchFailed({
      jobId: input.processingJobId,
      jobType: input.jobType,
      errorMessage,
    })
  } catch (recoveryError) {
    console.error('Failed to persist meeting task dispatch failure', {
      processingJobId: input.processingJobId,
      jobType: input.jobType,
      recoveryError,
    })
    return 'recovery_failed'
  }
}

export function meetingTaskDispatchFailureMessage(
  jobType: DispatchableMeetingJobType,
  status: ProcessingJob['status'] | 'recovery_failed',
): string {
  const taskLabel = jobType === 'transcription' ? '会议记录任务' : '需求提炼任务'
  if (status === 'failed') {
    return `${taskLabel}后台调度失败，失败记录与原始输入已保留，可从处理状态重新提交。`
  }
  if (status === 'running' || status === 'succeeded') {
    return `${taskLabel}可能已被后台接收，请查看处理状态。`
  }
  return `${taskLabel}后台调度状态暂时无法确认，请刷新处理状态后再操作。`
}

'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { publishInitialRequirementBaseline } from '@/app/actions/requirements'
import { Button } from '@/components/ui/button'

interface ConfirmRequirementButtonProps {
  projectId: string
  requirementId: string
  continueToAnalysis?: boolean
}

export function ConfirmRequirementButton({
  projectId,
  requirementId,
  continueToAnalysis = false,
}: ConfirmRequirementButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const confirmAndContinue = () => {
    startTransition(async () => {
      const result = await publishInitialRequirementBaseline(projectId, requirementId)
      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success('当前需求已确认为正式版本')
      if (continueToAnalysis) {
        router.push(`/projects/${projectId}/analysis`)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <Button
      type="button"
      className="bg-green-600 text-white hover:bg-green-700"
      onClick={confirmAndContinue}
      disabled={isPending}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ArrowRight className="h-4 w-4" />
      )}
      {isPending ? '正在确认需求' : continueToAnalysis ? '确认并进入方案分析' : '确认当前需求'}
    </Button>
  )
}

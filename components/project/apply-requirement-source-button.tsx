'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { applyRequirementSource } from '@/app/actions/requirements'
import { Button } from '@/components/ui/button'

interface ApplyRequirementSourceButtonProps {
  projectId: string
  requirementId: string
  expectedBaselineId: string | null
  compact?: boolean
}

export function ApplyRequirementSourceButton({
  projectId,
  requirementId,
  expectedBaselineId,
  compact = false,
}: ApplyRequirementSourceButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function applySource() {
    startTransition(async () => {
      const result = await applyRequirementSource(
        projectId,
        requirementId,
        expectedBaselineId,
      )
      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success(expectedBaselineId ? '项目需求已更新' : '正式需求已创建', {
        description: '新的正式需求版本已生效，旧版本仍保留用于审计。',
      })
      router.refresh()
    })
  }

  return (
    <Button
      type="button"
      size={compact ? 'sm' : 'default'}
      variant={compact ? 'outline' : 'default'}
      disabled={isPending}
      onClick={applySource}
    >
      {isPending ? <Loader2 className="animate-spin" /> : <Check />}
      {isPending ? '正在更新…' : expectedBaselineId ? '确认并更新项目需求' : '确认当前需求'}
    </Button>
  )
}

'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { publishEstimateVersion } from '@/app/actions/estimate-versions'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface PublishEstimateVersionButtonProps {
  projectId: string
  versionId: string
  revisionNo: number
}

export function PublishEstimateVersionButton({
  projectId,
  versionId,
  revisionNo,
}: PublishEstimateVersionButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const publishVersion = () => {
    startTransition(async () => {
      const result = await publishEstimateVersion(projectId, versionId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`估算版本 v${revisionNo} 已发布`)
      router.refresh()
    })
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          发布此版本
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>发布估算版本 v{revisionNo}？</AlertDialogTitle>
          <AlertDialogDescription>
            报告和导出将切换到该不可变版本。后续仍可创建新版本，再次审核后发布。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={publishVersion}>确认发布</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

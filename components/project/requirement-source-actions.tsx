'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FileUp, Keyboard, MessageCircle, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { FileUpload } from '@/components/project/file-upload'
import { RequirementElicitation } from '@/components/project/requirement-elicitation'
import { RequirementInput } from '@/components/project/requirement-input'
import type { Requirement } from '@/types'

interface RequirementSourceActionsProps {
  projectId: string
  editableRequirement?: Requirement | null
  activeElicitationSessionId?: string | null
  canUseElicitation: boolean
}

export function RequirementSourceActions({
  projectId,
  editableRequirement,
  activeElicitationSessionId,
  canUseElicitation,
}: RequirementSourceActionsProps) {
  const [textOpen, setTextOpen] = useState(false)
  const [documentOpen, setDocumentOpen] = useState(false)

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Dialog open={textOpen} onOpenChange={setTextOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="h-auto w-full justify-start gap-3 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-sky-500/10 text-sky-700">
              <Keyboard className="h-4 w-4" />
            </span>
            <span className="text-left">
              <span className="block font-medium">输入需求文本</span>
              <span className="block text-xs font-normal text-muted-foreground">
                {editableRequirement ? '继续编辑需求草稿' : '添加一条需求文本'}
              </span>
            </span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editableRequirement ? '编辑需求草稿' : '添加需求文本'}</DialogTitle>
            <DialogDescription>
              保存后会作为待确认需求来源，不会直接覆盖当前正式需求。
            </DialogDescription>
          </DialogHeader>
          <RequirementInput
            key={editableRequirement?.id ?? 'new-requirement'}
            projectId={projectId}
            requirement={editableRequirement}
            embedded
            onSaved={() => setTextOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={documentOpen} onOpenChange={setDocumentOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="h-auto w-full justify-start gap-3 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-700">
              <FileUp className="h-4 w-4" />
            </span>
            <span className="text-left">
              <span className="block font-medium">上传需求文档</span>
              <span className="block text-xs font-normal text-muted-foreground">支持 PDF 与 DOCX</span>
            </span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>添加需求文档</DialogTitle>
            <DialogDescription>
              系统会提取文档正文并保存为一条待确认需求来源。
            </DialogDescription>
          </DialogHeader>
          <FileUpload projectId={projectId} embedded onSaved={() => setDocumentOpen(false)} />
        </DialogContent>
      </Dialog>

      <Button variant="outline" className="h-auto w-full justify-start gap-3 py-3" asChild>
        <Link href={`/projects/${projectId}/meetings`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-rose-500/10 text-rose-700">
            <Mic className="h-4 w-4" />
          </span>
          <span className="text-left">
            <span className="block font-medium">添加会议音频</span>
            <span className="block text-xs font-normal text-muted-foreground">转写后确认需求影响</span>
          </span>
        </Link>
      </Button>

      {canUseElicitation ? (
        <RequirementElicitation
          projectId={projectId}
          initialSessionId={activeElicitationSessionId}
        />
      ) : (
        <Button variant="outline" className="h-auto w-full justify-start gap-3 py-3" disabled>
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <MessageCircle className="h-4 w-4" />
          </span>
          <span className="text-left">
            <span className="block font-medium">AI 需求澄清</span>
            <span className="block text-xs font-normal text-muted-foreground">先输入一份初始需求</span>
          </span>
        </Button>
      )}
    </div>
  )
}

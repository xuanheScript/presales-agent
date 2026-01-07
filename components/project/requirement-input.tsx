'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Save } from 'lucide-react'
import { createRequirement, updateRequirement } from '@/app/actions/requirements'
import { toast } from 'sonner'
import type { Requirement } from '@/types'

interface RequirementInputProps {
  projectId: string
  requirement?: Requirement | null
}

export function RequirementInput({ projectId, requirement }: RequirementInputProps) {
  const router = useRouter()
  const [content, setContent] = useState(requirement?.raw_content || '')
  const [isSaving, startSaveTransition] = useTransition()

  const handleSave = async () => {
    if (!content.trim()) {
      toast.error('请输入需求内容')
      return
    }

    startSaveTransition(async () => {
      let result
      if (requirement) {
        result = await updateRequirement(requirement.id, content)
      } else {
        result = await createRequirement(projectId, content)
      }

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('需求已保存')
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>需求文本</CardTitle>
        <CardDescription>
          直接输入或粘贴需求文档内容
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder="请输入项目需求描述...

例如：
- 项目背景和目标
- 核心功能需求
- 技术要求
- 性能需求
- 其他特殊要求"
          rows={12}
          className="resize-none font-mono text-sm"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={isSaving}
        />
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={isSaving || !content.trim()}
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            保存需求
          </Button>
        </div>
        {requirement && (
          <p className="text-xs text-muted-foreground">
            上次保存: {new Date(requirement.created_at).toLocaleString('zh-CN')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

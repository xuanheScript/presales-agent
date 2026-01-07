'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal, Pencil, Power, Trash2 } from 'lucide-react'
import { deleteTemplate, toggleTemplateActive } from '@/app/actions/templates'
import { toast } from 'sonner'

interface TemplateActionsProps {
  templateId: string
  isActive: boolean
}

export function TemplateActions({ templateId, isActive }: TemplateActionsProps) {
  const handleToggleActive = async () => {
    const result = await toggleTemplateActive(templateId)
    if (result.success) {
      toast.success(isActive ? '模板已停用' : '模板已启用')
    } else {
      toast.error(result.error || '操作失败')
    }
  }

  const handleDelete = async () => {
    if (!confirm('确定要删除这个模板吗？')) {
      return
    }

    const result = await deleteTemplate(templateId)
    if (result.success) {
      toast.success('模板已删除')
    } else {
      toast.error(result.error || '删除失败')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/templates/${templateId}`}>
            <Pencil className="mr-2 h-4 w-4" />
            编辑
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleToggleActive}>
          <Power className="mr-2 h-4 w-4" />
          {isActive ? '停用' : '启用'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDelete} className="text-red-600">
          <Trash2 className="mr-2 h-4 w-4" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

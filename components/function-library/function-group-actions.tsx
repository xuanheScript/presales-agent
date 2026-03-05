'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { deleteFunctionGroup } from '@/app/actions/function-groups'
import { FunctionGroupDialog } from './function-group-dialog'
import type { FunctionGroup, FunctionLibraryItem, FunctionGroupItemDetail } from '@/types'
import { toast } from 'sonner'

interface FunctionGroupActionsProps {
  group: FunctionGroup
  groupItems: FunctionGroupItemDetail[]
  allFunctions: FunctionLibraryItem[]
}

export function FunctionGroupActions({ group, groupItems, allFunctions }: FunctionGroupActionsProps) {
  const handleDelete = async () => {
    if (!confirm(`确定要删除功能组「${group.name}」吗？`)) {
      return
    }

    const result = await deleteFunctionGroup(group.id)
    if (result.success) {
      toast.success('功能组已删除')
    } else {
      toast.error(result.error || '删除失败')
    }
  }

  if (group.is_preset) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <FunctionGroupDialog
          group={group}
          groupItems={groupItems}
          allFunctions={allFunctions}
          isEdit
        >
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <Pencil className="mr-2 h-4 w-4" />
            编辑
          </DropdownMenuItem>
        </FunctionGroupDialog>
        <DropdownMenuItem
          onClick={handleDelete}
          className="text-red-600"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

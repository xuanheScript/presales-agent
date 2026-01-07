'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { deleteFunctionLibraryItem } from '@/app/actions/function-library'
import { FunctionLibraryDialog } from './function-library-dialog'
import type { FunctionLibraryItem } from '@/types'
import { toast } from 'sonner'

interface FunctionLibraryActionsProps {
  item: FunctionLibraryItem
}

export function FunctionLibraryActions({ item }: FunctionLibraryActionsProps) {
  const handleDelete = async () => {
    if (!confirm('确定要删除这个功能吗？')) {
      return
    }

    const result = await deleteFunctionLibraryItem(item.id)
    if (result.success) {
      toast.success('功能已删除')
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
        <FunctionLibraryDialog item={item} isEdit>
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <Pencil className="mr-2 h-4 w-4" />
            编辑
          </DropdownMenuItem>
        </FunctionLibraryDialog>
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

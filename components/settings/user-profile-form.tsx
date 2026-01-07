'use client'

import { useActionState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Loader2, Save, User } from 'lucide-react'
import { updateUserProfile } from '@/app/actions/settings'
import { toast } from 'sonner'

interface UserProfileFormProps {
  profile: {
    email: string
    name: string | null
    avatar_url: string | null
  } | null
}

interface FormState {
  success: boolean
  error?: string
}

export function UserProfileForm({ profile }: UserProfileFormProps) {
  const handleSubmit = async (
    _prevState: FormState,
    formData: FormData
  ): Promise<FormState> => {
    const result = await updateUserProfile(formData)
    if (result.success) {
      toast.success('资料已更新')
    }
    return result
  }

  const [state, formAction, isPending] = useActionState(handleSubmit, {
    success: false,
  })

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    }
  }, [state.error])

  if (!profile) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        请先登录
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-6">
      <div className="flex items-center gap-6">
        <Avatar className="h-20 w-20">
          <AvatarImage src={profile.avatar_url || undefined} />
          <AvatarFallback className="text-2xl">
            {profile.name?.[0]?.toUpperCase() || profile.email[0]?.toUpperCase() || (
              <User className="h-8 w-8" />
            )}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <p className="font-medium">{profile.name || '未设置姓名'}</p>
          <p className="text-sm text-muted-foreground">{profile.email}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* 邮箱（只读） */}
        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            type="email"
            value={profile.email}
            disabled
            className="bg-muted"
          />
          <p className="text-xs text-muted-foreground">
            邮箱地址不可修改
          </p>
        </div>

        {/* 姓名 */}
        <div className="space-y-2">
          <Label htmlFor="full_name">姓名</Label>
          <Input
            id="full_name"
            name="full_name"
            defaultValue={profile.name || ''}
            placeholder="输入你的姓名"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              保存中...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              保存资料
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

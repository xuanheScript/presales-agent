import type { SupabaseClient, User } from '@supabase/supabase-js'

export class MeetingPermissionError extends Error {
  constructor(message = '项目不存在或无权限访问') {
    super(message)
    this.name = 'MeetingPermissionError'
  }
}

export async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    throw new MeetingPermissionError('请先登录')
  }
  return user
}

export async function requireProjectOwner(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('created_by', userId)
    .maybeSingle()

  if (error || !data) {
    throw new MeetingPermissionError()
  }
}

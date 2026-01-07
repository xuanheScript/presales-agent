'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export interface AuthResult {
  error?: string
  success?: boolean
}

export async function signIn(formData: FormData): Promise<AuthResult> {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: '请填写邮箱和密码' }
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: error.message }
  }

  redirect('/dashboard')
}

export async function signUp(formData: FormData): Promise<AuthResult> {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('fullName') as string

  if (!email || !password) {
    return { error: '请填写邮箱和密码' }
  }

  if (password.length < 6) {
    return { error: '密码长度至少为6位' }
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  })

  if (error) {
    return { error: error.message }
  }

  redirect('/dashboard')
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function getUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function getSession() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

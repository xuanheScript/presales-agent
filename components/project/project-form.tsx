'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createProject, updateProject, type ActionResult } from '@/app/actions/projects'
import { INDUSTRIES } from '@/constants'
import type { Project } from '@/types'
import { Loader2 } from 'lucide-react'

interface ProjectFormProps {
  project?: Project
  mode?: 'create' | 'edit'
}

export function ProjectForm({ project, mode = 'create' }: ProjectFormProps) {
  const isEdit = mode === 'edit' && project

  const action = isEdit
    ? async (_state: ActionResult | null, formData: FormData) => {
        return await updateProject(project.id, formData)
      }
    : async (_state: ActionResult | null, formData: FormData) => {
        return await createProject(formData)
      }

  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? '编辑项目' : '新建项目'}</CardTitle>
        <CardDescription>
          {isEdit ? '修改项目基本信息' : '填写项目基本信息以开始估算'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-6">
          {/* 项目名称 */}
          <div className="space-y-2">
            <Label htmlFor="name">
              项目名称 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              placeholder="输入项目名称"
              defaultValue={project?.name || ''}
              required
            />
          </div>

          {/* 行业选择 */}
          <div className="space-y-2">
            <Label htmlFor="industry">所属行业</Label>
            <Select name="industry" defaultValue={project?.industry || ''}>
              <SelectTrigger>
                <SelectValue placeholder="选择行业" />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((industry) => (
                  <SelectItem key={industry} value={industry}>
                    {industry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 项目描述 */}
          <div className="space-y-2">
            <Label htmlFor="description">项目描述</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="简要描述项目背景和目标..."
              rows={4}
              defaultValue={project?.description || ''}
            />
          </div>

          {/* 错误提示 */}
          {state?.error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {state.error}
            </div>
          )}

          {/* 提交按钮 */}
          <div className="flex gap-4">
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? '保存修改' : '创建项目'}
            </Button>
            {!isEdit && (
              <Button type="reset" variant="outline" disabled={isPending}>
                重置
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

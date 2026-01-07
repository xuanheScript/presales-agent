'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Save, FileText } from 'lucide-react'
import { createTemplate, updateTemplate } from '@/app/actions/templates'
import { INDUSTRIES } from '@/constants'
import type { Template, TemplateType } from '@/types'
import { useEffect } from 'react'
import { toast } from 'sonner'

// 模板类型选项
const TEMPLATE_TYPE_OPTIONS: { value: TemplateType; label: string; description: string }[] = [
  {
    value: 'requirement_analysis',
    label: '需求分析',
    description: '分析需求文档，提取关键信息',
  },
  {
    value: 'function_breakdown',
    label: '功能拆解',
    description: '将需求拆解为功能模块',
  },
  {
    value: 'effort_estimation',
    label: '工时评估',
    description: '估算开发工时和人员配置',
  },
  {
    value: 'cost_calculation',
    label: '成本计算',
    description: '计算项目成本和报价',
  },
]

interface TemplateFormProps {
  template?: Template
  isEdit?: boolean
}

interface FormState {
  success: boolean
  error?: string
  id?: string
}

export function TemplateForm({ template, isEdit = false }: TemplateFormProps) {
  const router = useRouter()

  const handleSubmit = async (
    _prevState: FormState,
    formData: FormData
  ): Promise<FormState> => {
    if (isEdit && template) {
      const result = await updateTemplate(template.id, formData)
      if (result.success) {
        toast.success('模板已更新')
        router.push('/templates')
      }
      return result
    } else {
      const result = await createTemplate(formData)
      if (result.success) {
        toast.success('模板创建成功')
        router.push('/templates')
      }
      return result
    }
  }

  const [state, formAction, isPending] = useActionState(handleSubmit, {
    success: false,
  })

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    }
  }, [state.error])

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {isEdit ? '编辑模板' : '新建模板'}
          </CardTitle>
          <CardDescription>
            {isEdit ? '修改提示词模板内容' : '创建新的提示词模板'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 模板类型 */}
          <div className="space-y-2">
            <Label htmlFor="template_type">模板类型 *</Label>
            <Select
              name="template_type"
              defaultValue={template?.template_type}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择模板类型" />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <div>
                      <div className="font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {option.description}
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 模板名称 */}
          <div className="space-y-2">
            <Label htmlFor="template_name">模板名称 *</Label>
            <Input
              id="template_name"
              name="template_name"
              defaultValue={template?.template_name}
              placeholder="例如：电商项目需求分析模板"
              required
            />
          </div>

          {/* 适用行业 */}
          <div className="space-y-2">
            <Label htmlFor="industry">适用行业</Label>
            <Select name="industry" defaultValue={template?.industry || '__all__'}>
              <SelectTrigger>
                <SelectValue placeholder="通用（所有行业）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">通用（所有行业）</SelectItem>
                {INDUSTRIES.map((industry) => (
                  <SelectItem key={industry} value={industry}>
                    {industry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              选择特定行业后，该模板仅用于对应行业的项目
            </p>
          </div>

          {/* 提示词内容 */}
          <div className="space-y-2">
            <Label htmlFor="prompt_content">提示词内容 *</Label>
            <Textarea
              id="prompt_content"
              name="prompt_content"
              defaultValue={template?.prompt_content}
              placeholder="输入提示词内容...&#10;&#10;可使用变量：&#10;{需求内容} - 用户输入的需求&#10;{行业} - 项目所属行业&#10;{功能列表} - 已识别的功能模块"
              className="min-h-[300px] font-mono text-sm"
              required
            />
            <p className="text-xs text-muted-foreground">
              使用 {'{变量名}'} 格式插入动态内容
            </p>
          </div>

          {/* 编辑模式下的额外选项 */}
          {isEdit && (
            <>
              {/* 启用状态 */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="is_active">启用状态</Label>
                  <p className="text-xs text-muted-foreground">
                    停用后该模板不会被 Agent 使用
                  </p>
                </div>
                <Switch
                  id="is_active"
                  name="is_active"
                  defaultChecked={template?.is_active}
                  value="true"
                />
              </div>

              {/* 创建新版本 */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="create_new_version">创建新版本</Label>
                  <p className="text-xs text-muted-foreground">
                    保存为新版本，保留历史版本记录
                  </p>
                </div>
                <Switch
                  id="create_new_version"
                  name="create_new_version"
                  value="true"
                />
              </div>
            </>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  保存
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}

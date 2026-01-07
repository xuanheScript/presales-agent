import { TemplateForm } from '@/components/template/template-form'

export default function NewTemplatePage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">新建模板</h2>
        <p className="text-muted-foreground">
          创建新的 AI 提示词模板
        </p>
      </div>

      <div className="max-w-2xl">
        <TemplateForm />
      </div>
    </div>
  )
}

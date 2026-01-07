import { notFound } from 'next/navigation'
import { getTemplate } from '@/app/actions/templates'
import { TemplateForm } from '@/components/template/template-form'

interface TemplateEditPageProps {
  params: Promise<{ id: string }>
}

export default async function TemplateEditPage({ params }: TemplateEditPageProps) {
  const { id } = await params
  const template = await getTemplate(id)

  if (!template) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">编辑模板</h2>
        <p className="text-muted-foreground">
          {template.template_name} - v{template.version}
        </p>
      </div>

      <div className="max-w-2xl">
        <TemplateForm template={template} isEdit />
      </div>
    </div>
  )
}

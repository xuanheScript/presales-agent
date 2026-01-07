'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Upload, FileText, X, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { createRequirement } from '@/app/actions/requirements'

interface FileUploadProps {
  projectId: string
  onParsed?: (content: string) => void
}

type UploadState = 'idle' | 'validating' | 'parsing' | 'saving' | 'success' | 'error'

interface UploadedFile {
  file: File
  state: UploadState
  progress: number
  error?: string
  content?: string
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function isValidDocumentType(file: File): boolean {
  const fileName = file.name.toLowerCase()
  return fileName.endsWith('.pdf') || fileName.endsWith('.docx')
}

export function FileUpload({ projectId, onParsed }: FileUploadProps) {
  const router = useRouter()
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const resetUpload = () => {
    setUploadedFile(null)
  }

  const processFile = async (file: File) => {
    // 初始化上传状态
    setUploadedFile({
      file,
      state: 'validating',
      progress: 10,
    })

    // 验证文件类型
    if (!isValidDocumentType(file)) {
      setUploadedFile({
        file,
        state: 'error',
        progress: 0,
        error: '不支持的文件格式，请上传 .docx 或 .pdf 文件',
      })
      return
    }

    // 验证文件大小
    if (file.size > MAX_FILE_SIZE) {
      setUploadedFile({
        file,
        state: 'error',
        progress: 0,
        error: `文件大小超过限制 (最大 ${formatFileSize(MAX_FILE_SIZE)})`,
      })
      return
    }

    // 开始解析
    setUploadedFile((prev) => ({
      ...prev!,
      state: 'parsing',
      progress: 30,
    }))

    try {
      // 调用服务端 API 解析文档
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/parse-document', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        setUploadedFile((prev) => ({
          ...prev!,
          state: 'error',
          progress: 0,
          error: result.error || '文档解析失败',
        }))
        return
      }

      // 解析成功
      setUploadedFile((prev) => ({
        ...prev!,
        state: 'success',
        progress: 100,
        content: result.content,
      }))

      // 通知父组件
      if (result.content && onParsed) {
        onParsed(result.content)
      }

      toast.success('文档解析成功', {
        description: `已提取 ${result.metadata?.wordCount || 0} 个字符`,
      })
    } catch (error) {
      setUploadedFile((prev) => ({
        ...prev!,
        state: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : '解析过程出错',
      }))
    }
  }

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      const file = files[0]
      processFile(file)
    },
    []
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      handleFileSelect(e.dataTransfer.files)
    },
    [handleFileSelect]
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleSaveRequirement = async () => {
    if (!uploadedFile?.content) return

    setUploadedFile((prev) => ({
      ...prev!,
      state: 'saving',
      progress: 80,
    }))

    try {
      const result = await createRequirement(projectId, uploadedFile.content, 'document')

      if (result.error) {
        toast.error(result.error)
        setUploadedFile((prev) => ({
          ...prev!,
          state: 'error',
          error: result.error,
        }))
        return
      }

      toast.success('需求已保存')
      router.refresh()
      resetUpload()
    } catch (error) {
      toast.error('保存失败')
      setUploadedFile((prev) => ({
        ...prev!,
        state: 'error',
        error: '保存失败',
      }))
    }
  }

  const getStateIcon = (state: UploadState) => {
    switch (state) {
      case 'validating':
      case 'parsing':
      case 'saving':
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-500" />
      default:
        return <FileText className="h-5 w-5 text-muted-foreground" />
    }
  }

  const getStateText = (state: UploadState) => {
    switch (state) {
      case 'validating':
        return '验证中...'
      case 'parsing':
        return '解析中...'
      case 'saving':
        return '保存中...'
      case 'success':
        return '解析完成'
      case 'error':
        return '失败'
      default:
        return ''
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>文档上传</CardTitle>
        <CardDescription>
          上传 Word (.docx) 或 PDF (.pdf) 格式的需求文档
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 上传区域 */}
        {!uploadedFile && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`
              relative flex flex-col items-center justify-center
              rounded-lg border-2 border-dashed p-8
              transition-colors
              ${isDragging
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
              }
            `}
          >
            <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
            <p className="mb-2 text-sm font-medium">
              拖拽文件到这里，或{' '}
              <label className="cursor-pointer text-primary hover:underline">
                点击选择文件
                <input
                  type="file"
                  className="hidden"
                  accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => handleFileSelect(e.target.files)}
                />
              </label>
            </p>
            <p className="text-xs text-muted-foreground">
              支持 .docx 和 .pdf 格式，最大 {formatFileSize(MAX_FILE_SIZE)}
            </p>
          </div>
        )}

        {/* 文件状态显示 */}
        {uploadedFile && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border p-3">
              {getStateIcon(uploadedFile.state)}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {uploadedFile.file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(uploadedFile.file.size)}
                  {uploadedFile.state !== 'idle' && (
                    <span className="ml-2">{getStateText(uploadedFile.state)}</span>
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={resetUpload}
                disabled={uploadedFile.state === 'parsing' || uploadedFile.state === 'saving'}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* 进度条 */}
            {['validating', 'parsing', 'saving'].includes(uploadedFile.state) && (
              <Progress value={uploadedFile.progress} className="h-1" />
            )}

            {/* 错误信息 */}
            {uploadedFile.state === 'error' && uploadedFile.error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
                {uploadedFile.error}
              </div>
            )}

            {/* 解析成功后的内容预览 */}
            {uploadedFile.state === 'success' && uploadedFile.content && (
              <div className="space-y-3">
                <div className="rounded-md bg-muted p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    解析内容预览
                  </p>
                  <p className="line-clamp-4 text-sm">
                    {uploadedFile.content.slice(0, 500)}
                    {uploadedFile.content.length > 500 && '...'}
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={resetUpload}>
                    重新上传
                  </Button>
                  <Button onClick={handleSaveRequirement}>
                    保存为需求
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

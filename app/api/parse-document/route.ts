import { NextResponse } from 'next/server'
import mammoth from 'mammoth'

/**
 * POST /api/parse-document
 *
 * 解析上传的文档（Word 或 PDF）
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { error: '请上传文件' },
        { status: 400 }
      )
    }

    const fileName = file.name.toLowerCase()
    const extension = fileName.split('.').pop()

    // 验证文件类型
    if (!['docx', 'pdf'].includes(extension || '')) {
      return NextResponse.json(
        { error: '不支持的文件格式，请上传 .docx 或 .pdf 文件' },
        { status: 400 }
      )
    }

    // 验证文件大小（10MB）
    const MAX_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: '文件大小超过限制（最大 10MB）' },
        { status: 400 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    // 转换为 Node.js Buffer
    const buffer = Buffer.from(arrayBuffer)
    let content: string

    if (extension === 'docx') {
      // 解析 Word 文档
      const result = await mammoth.extractRawText({
        buffer: buffer,
      })
      content = result.value.trim()
    } else if (extension === 'pdf') {
      // 动态导入 pdf-parse（仅在服务端）
      const { PDFParse } = await import('pdf-parse')
      const uint8Array = new Uint8Array(arrayBuffer)
      const parser = new PDFParse({ data: uint8Array })
      const textResult = await parser.getText()
      content = textResult.text.trim()
    } else {
      return NextResponse.json(
        { error: '不支持的文件格式' },
        { status: 400 }
      )
    }

    if (!content) {
      return NextResponse.json(
        { error: '文档内容为空' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      content,
      metadata: {
        fileName: file.name,
        fileType: extension,
        wordCount: content.length,
      },
    })
  } catch (error) {
    console.error('文档解析失败:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '文档解析失败' },
      { status: 500 }
    )
  }
}

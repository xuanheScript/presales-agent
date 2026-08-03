import { describe, expect, it } from 'vitest'
import { highlightLiteralText } from './highlight-text'

describe('highlightLiteralText', () => {
  it('按字面值高亮中文的多次匹配', () => {
    expect(highlightLiteralText('需求文档包含需求范围。', '需求')).toEqual([
      { text: '需求', highlighted: true },
      { text: '文档包含', highlighted: false },
      { text: '需求', highlighted: true },
      { text: '范围。', highlighted: false },
    ])
  })

  it('忽略英文大小写并保留原文', () => {
    expect(highlightLiteralText('PDF 与 pdf 文档', 'Pdf')).toEqual([
      { text: 'PDF', highlighted: true },
      { text: ' 与 ', highlighted: false },
      { text: 'pdf', highlighted: true },
      { text: ' 文档', highlighted: false },
    ])
  })

  it('将正则和 HTML 特殊字符作为普通文本处理', () => {
    const content = '<script>alert(1)</script> [范围.*]'
    expect(highlightLiteralText(content, '[范围.*]')).toEqual([
      { text: '<script>alert(1)</script> ', highlighted: false },
      { text: '[范围.*]', highlighted: true },
    ])
  })

  it('保留换行，空查询返回完整原文', () => {
    const content = '第一行\n第二行'
    expect(highlightLiteralText(content, '  ')).toEqual([
      { text: content, highlighted: false },
    ])
  })

  it('处理空正文', () => {
    expect(highlightLiteralText('', '需求')).toEqual([])
  })
})

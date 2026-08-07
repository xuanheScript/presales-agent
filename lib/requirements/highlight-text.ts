export interface HighlightTextSegment {
  text: string
  highlighted: boolean
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function highlightLiteralText(
  content: string,
  query: string,
): HighlightTextSegment[] {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return content ? [{ text: content, highlighted: false }] : []
  }

  const segments: HighlightTextSegment[] = []
  const matches = content.matchAll(new RegExp(escapeRegExp(normalizedQuery), 'giu'))
  let cursor = 0

  for (const match of matches) {
    const matchStart = match.index
    if (matchStart > cursor) {
      segments.push({
        text: content.slice(cursor, matchStart),
        highlighted: false,
      })
    }

    const matchEnd = matchStart + match[0].length
    segments.push({
      text: content.slice(matchStart, matchEnd),
      highlighted: true,
    })
    cursor = matchEnd
  }

  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor), highlighted: false })
  }

  return segments
}

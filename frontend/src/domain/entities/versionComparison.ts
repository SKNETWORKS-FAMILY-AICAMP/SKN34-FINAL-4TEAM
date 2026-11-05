export type TextChange = { kind: 'same' | 'removed' | 'added'; text: string }

/** 줄바꿈까지 보존하며 저장 원고 두 개를 비교한다. */
export function compareText(before: string, after: string): { parts: TextChange[]; grouped: boolean } {
  if (before === after) return { parts: before ? [{ kind: 'same', text: before }] : [], grouped: false }
  const a = before.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const b = after.match(/[^\n]*\n|[^\n]+$/g) ?? []
  let start = 0, endA = a.length, endB = b.length
  while (start < endA && start < endB && a[start] === b[start]) start++
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const parts: TextChange[] = []
  const append = (kind: TextChange['kind'], text: string) => {
    if (!text) return
    const last = parts.at(-1)
    if (last?.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  append('same', a.slice(0, start).join(''))
  const rows = endA - start, cols = endB - start
  // shortcut: 비교 표를 약 4 MB로 제한한다. 초과한 변경부는 구간 단위로 표시한다.
  const grouped = (rows + 1) * (cols + 1) > 1_000_000
  if (grouped) {
    append('removed', a.slice(start, endA).join(''))
    append('added', b.slice(start, endB).join(''))
  } else {
    const width = cols + 1, lengths = new Uint32Array((rows + 1) * width)
    for (let i = rows - 1; i >= 0; i--) for (let j = cols - 1; j >= 0; j--) {
      lengths[i * width + j] = a[start + i] === b[start + j]
        ? 1 + lengths[(i + 1) * width + j + 1]
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
    }
    let i = 0, j = 0
    while (i < rows || j < cols) {
      if (i < rows && j < cols && a[start + i] === b[start + j]) {
        append('same', a[start + i]); i++; j++
      } else if (i < rows && (j === cols || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) {
        append('removed', a[start + i++])
      } else append('added', b[start + j++])
    }
  }
  append('same', a.slice(endA).join(''))
  return { parts, grouped }
}

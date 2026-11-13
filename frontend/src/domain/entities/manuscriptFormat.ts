import { imageMarker, imageReferencePattern } from './media'

/*
 * 원고 기본 서식(DEC-48)의 문법. 정본은 docs/design/manuscript-format-contract.md이고 서버(Kotlin, EPUB 내보내기)가 같은 검증 표로 따로 구현하므로
 * 여기서 문법을 넓히거나 좁히지 않는다. 저장한 글은 바꾸지 않고 그릴 때만 해석한다.
 */

/**
 * 줄 안 서식을 푼 글자 조각. text는 그릴 글자다. start~end는 이 조각이 원문에서 차지하는 자리로, 조각을 감싼 기호(`**`·`*`)와 이스케이프 백슬래시를 포함해
 * 한 줄의 조각을 이으면 그 줄의 내용 전체가 된다. at은 그 자리 안에서 글자가 시작하는 곳이다(원문의 at부터 text 길이만큼이 text와 같다).
 */
export type InlinePart = { text: string; bold: boolean; italic: boolean; start: number; at: number; end: number }

/** 줄 하나의 종류. at은 줄 맨 앞 기호(`## `·`> `·문단 줄의 `\`) 뒤, 줄 안 서식을 해석할 내용이 시작하는 곳이다. */
export type ManuscriptLine =
  | { kind: 'blank' }
  | { kind: 'rule' }
  | { kind: 'image'; id: string }
  | { kind: 'heading' | 'quote' | 'paragraph'; at: number }

/** 이어진 줄을 묶은 블록. start와 조각의 자리는 본문 전체 기준이다. 빈 줄은 이어진 개수(count)만 갖고 간격은 그리는 쪽이 정한다. */
export type ManuscriptBlock =
  | { kind: 'paragraph' | 'quote' | 'heading'; start: number; lines: InlinePart[][] }
  | { kind: 'rule' }
  | { kind: 'image'; id: string }
  | { kind: 'blank'; count: number }

const IMAGE = new RegExp(`^${imageReferencePattern.source}$`, 'i')
const RULE = /^(-{3,}|\*{3,})$/
const HEADING = /^#{1,6} (.*\S.*)$/
const QUOTE = /^> ?(.*)$/
// 계약의 두 정규식 그대로다. 공백(\s·\S)은 JavaScript 기준(전각 공백 포함)이다.
const BOLD = /(?<!\\)\*\*(?=\S)(.+?)(?<=\S)(?<!\\)\*\*(?!\*)/g
const ITALIC = /(?<![\\*])\*(?=[^\s*])(.+?)(?<=[^\s*])(?<!\\)\*(?!\*)/g
const find = (pattern: RegExp, text: string, from: number) => { pattern.lastIndex = from; return pattern.exec(text) }

/** 줄 하나를 위에서부터 처음 맞는 규칙으로 판정한다: 빈 줄 → 이미지 → 구분선 → 소제목 → 인용 → 문단 줄. */
export function manuscriptLine(line: string): ManuscriptLine {
  if (!line) return { kind: 'blank' }
  const id = IMAGE.exec(line)?.[1]
  // 표식을 다시 만든 글이 줄과 같을 때만 이미지다(소문자 image, 앞뒤 공백 없음).
  if (id && imageMarker(id) === line) return { kind: 'image', id }
  if (RULE.test(line)) return { kind: 'rule' }
  const marked = HEADING.exec(line) ?? QUOTE.exec(line)
  if (marked) return { kind: line[0] === '#' ? 'heading' : 'quote', at: line.length - marked[1].length }
  // 줄 맨 앞의 \# \> \- 는 그 줄을 문단 줄로 두려는 표시라 백슬래시를 그리지 않는다(\*는 줄 안 서식이 맡는다).
  return { kind: 'paragraph', at: /^\\[#>-]/.test(line) ? 1 : 0 }
}

/**
 * 줄 안 서식을 해석하는 내용의 길이 상한(UTF-16 단위). 일부러 만든 긴 줄은 정규식이 길이의 제곱만큼 걸리고 겹침이 수천 단계가 되어 화면이 멈추거나
 * 스택이 넘친다(`*` 39,999개 + `a`). 넘는 내용은 해석하지 않고 그대로 그린다.
 */
const INLINE_MAX = 2000

/**
 * 줄 내용의 굵게·기울임을 푼다. 왼쪽부터 두 패턴 중 먼저 시작하는 것을 고르고 맞은 부분의 안쪽을 따로 떼어 같은 방법으로 다시 푼 뒤 그 뒤쪽을 이어서 찾는다
 * (뒤쪽은 반복이라 겹친 깊이만큼만 재귀한다). offset은 내용이 원문에서 시작하는 자리다.
 * 내용이 상한을 넘으면 굵게·기울임·`\*`를 해석하지 않고 내용 전체를 조각 하나로 돌려준다.
 */
export function inlineParts(content: string, offset = 0, bold = false, italic = false): InlinePart[] {
  if (content.length > INLINE_MAX) return [{ text: content, bold, italic, start: offset, at: offset, end: offset + content.length }]
  const parts: InlinePart[] = []
  /** 서식 없는 글자. `\*`는 별표가 되고 그 백슬래시는 별표로 시작하는 조각의 자리에만 남는다. */
  const plain = (from: number, to: number) => {
    for (let at = from; at < to;) {
      const start = at
      if (content.startsWith('\\*', at)) at++
      const next = content.indexOf('\\*', at + 1)
      const end = next < 0 || next > to ? to : next
      parts.push({ text: content.slice(at, end), bold, italic, start: offset + start, at: offset + at, end: offset + end })
      at = end
    }
  }
  let from = 0
  for (;;) {
    const strong = find(BOLD, content, from)
    const emphasis = find(ITALIC, content, from)
    const match = strong && (!emphasis || strong.index < emphasis.index) ? strong : emphasis
    if (!match) break
    const mark = match === strong ? 2 : 1
    plain(from, match.index)
    const inner = inlineParts(match[1], offset + match.index + mark, bold || mark === 2, italic || mark === 1)
    // 여는 기호는 안쪽 첫 조각, 닫는 기호는 안쪽 끝 조각의 자리에 넣는다.
    inner[0].start -= mark
    inner[inner.length - 1].end += mark
    parts.push(...inner)
    from = match.index + match[0].length
  }
  plain(from, content.length)
  return parts
}

/** 본문을 `\n`으로 나눈 줄을 블록으로 묶는다: 이어진 문단 줄·인용 줄은 한 블록, 소제목·구분선·이미지는 한 줄이 한 블록, 이어진 빈 줄은 개수만 센다. */
export function manuscriptBlocks(body: string): ManuscriptBlock[] {
  const blocks: ManuscriptBlock[] = []
  let offset = 0
  for (const text of body.split('\n')) {
    const line = manuscriptLine(text)
    const last = blocks.at(-1)
    if (line.kind === 'blank') {
      if (last?.kind === 'blank') last.count++
      else blocks.push({ kind: 'blank', count: 1 })
    } else if (line.kind === 'rule' || line.kind === 'image') blocks.push(line)
    else {
      const parts = inlineParts(text.slice(line.at), offset + line.at)
      if (last?.kind === line.kind && last.kind !== 'heading') last.lines.push(parts)
      else blocks.push({ kind: line.kind, start: offset, lines: [parts] })
    }
    offset += text.length + 1
  }
  return blocks
}

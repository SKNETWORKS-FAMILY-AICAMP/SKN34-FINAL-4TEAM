import { manuscriptBlocks, type InlinePart } from './manuscriptFormat'

/** 목업 S.comments의 댓글: [닉네임, 내용, 좋아요, 문장 인용·스포일러] */
export type CommentMeta = { q: string; spoiler: boolean }
export type Comment = [nick: string, text: string, likes: number, meta?: CommentMeta]

/** 회차 본문에서 고른 문장과 그 문단 번호. t는 댓글 인용·피드백·수정 제안에 보내는 글로, 본문에 글자 그대로 있는 조각이다. */
export type Sentence = { t: string; pi: number }

/** 목업 S.reports: 독자가 보낸 피드백·신고 기록 */
export type ReaderReport = { id: string; w: string; n: number | null; type: string; text: string; status: string; reply: string }

/** 목업 S.inbox: 작가 피드백함 항목 */
export type InboxItem = {
  id: string; rid: string; w: string; n: number; pi: number; type: string; who: string; text: string; baseText: string; status: string
  ai: { cls: string; why: string; ev: string }; from?: string; to?: string; answer?: string
}

/** 목업 S.admin.queue: 운영팀 신고 검토 목록 */
export type ReviewItem = { id: string; w: string; n: null; type: string; text: string; quote: string; status: string; who: string; appeal?: string; beforeHidden?: boolean }

export const FEEDBACK_TYPES = ['단순 오류', '스토리 오류', '질문', '제안'] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

export const REPORT_TYPES: [string, string][] = [['권리 침해', '저작권·인격권 등 권리 문제'], ['유해 콘텐츠', '안전한 이용을 해치는 콘텐츠']]

/** 목업 TYPO: 데모가 알아보는 표기 오류 */
export const TYPO: Record<string, string> = { '않 된다': '안 된다', '되뇌였다': '되뇌었다' }

/**
 * 독자 화면이 그리는 문장 하나. gap은 앞 문장과의 사이로, 원문에 줄바꿈이 있으면 그 수만큼의 '\n'이고 없으면 빈칸 하나다(블록의 첫 문장은 빈 글).
 * parts는 서식 기호를 뺀 글자 조각이다. 고른 문장의 보내는 글은 같은 순번의 Sentence.t다.
 */
export type ShownSentence = { gap: string; parts: Pick<InlinePart, 'text' | 'bold' | 'italic'>[] }

/** 독자 화면 본문의 블록. 문장은 문단·인용·소제목에만 있고 구분선·이미지·빈 줄(이어진 개수)은 문장이 아니다. */
export type ReaderBlock =
  | { kind: 'paragraph' | 'quote' | 'heading'; sentences: ShownSentence[] }
  | { kind: 'rule' }
  | { kind: 'image'; id: string }
  | { kind: 'blank'; count: number }

/** 목업 reader() body의 문장 나눔 규칙. 서식을 들이기 전부터 쓰던 것이라 바꾸지 않는다. */
const SENTENCE = /[^.!?”]+[.!?…]*”?|[^.!?]+$/g

/**
 * 이어진 조각(서식 기호를 뺀 글자)을 문장으로 나누고, 문장마다 원문에서 차지하는 자리(start~end)와 그릴 조각을 돌려준다.
 * 조각의 자리가 그 조각을 감싼 기호를 품으므로 문장 맨 앞의 여는 기호와 맨 끝의 닫는 기호는 그 문장의 자리에 들고, 기호만 남는 문장은 생기지 않는다.
 */
function cutSentences(pieces: InlinePart[]) {
  const text = pieces.map((p) => p.text).join('')
  const found = [...text.matchAll(SENTENCE)].map((m) => [m.index, m.index + m[0].length])
  // 문장은 앞에서부터 차례로 오므로 조각도 앞으로만 훑는다: head는 아직 끝나지 않은 첫 조각, base는 그 조각이 text에서 시작하는 자리다.
  let head = 0, base = 0
  return (found.length ? found : [[0, text.length]]).flatMap(([from, to]) => {
    // 앞뒤 공백을 뗀 자리. 공백뿐이면 문장이 아니다.
    const first = to - text.slice(from, to).trimStart().length
    const last = from + text.slice(from, to).trimEnd().length
    if (first >= last) return []
    while (head < pieces.length && base + pieces[head].text.length <= first) base += pieces[head++].text.length
    const parts: ShownSentence['parts'] = []
    let start = 0, end = 0
    for (let i = head, at = base; i < pieces.length && at < last; at += pieces[i++].text.length) {
      const p = pieces[i]
      const a = Math.max(first, at), b = Math.min(last, at + p.text.length)
      if (a >= b) continue
      if (!parts.length) start = a === at ? p.start : p.at + a - at
      end = b === at + p.text.length ? p.end : p.at + b - at
      const drawn = parts.at(-1)
      // 이스케이프로 나뉜 조각처럼 서식이 같은 이웃은 한 조각으로 잇는다.
      if (drawn && drawn.bold === p.bold && drawn.italic === p.italic) drawn.text += p.text.slice(a - at, b - at)
      else parts.push({ text: p.text.slice(a - at, b - at), bold: p.bold, italic: p.italic })
    }
    return [{ start, end, parts }]
  })
}

const newline = (at: number): InlinePart => ({ text: '\n', bold: false, italic: false, start: at, at, end: at + 1 })

/**
 * 문단 블록의 줄을 줄바꿈으로 이어, 문장을 나눌 한 덩어리로 만든다(문단 줄은 내용이 비지 않는다).
 * 옛 구현은 빈 줄 둘로 나눈 덩어리마다 문장을 나눴고 그 덩어리는 줄바꿈으로 시작하거나(빈 줄이 둘 이상 이어진 뒤) 끝날 수 있었다(본문 맨 끝).
 * 문장부호로 시작하는 문단은 그 줄바꿈에 따라 나뉘는 모양이 달라지므로, 서식 없는 글이 전과 같게 덩어리(from~to) 안의 앞뒤 줄바꿈도 넣는다.
 */
function paragraphUnit(lines: InlinePart[][], start: number, from: number, to: number) {
  const end = lines.at(-1)!.at(-1)!.end
  return [
    ...(start > from ? [newline(start - 1)] : []),
    ...lines.flatMap((line, i) => (i ? [newline(lines[i - 1].at(-1)!.end), ...line] : line)),
    ...(end + 1 === to ? [newline(end)] : []),
  ]
}

/**
 * 회차 본문을 독자 화면이 그릴 블록과 고를 수 있는 문장으로 읽는다(원고 기본 서식, DEC-48). paras는 Episode.p(본문을 빈 줄 둘로 나눈 덩어리)다.
 * - paragraphs[pi]는 pi번째 덩어리의 문장이고, 이어 붙인 순서가 blocks의 문장 순서(화면의 문장 순번)와 같다.
 * - 문장의 t는 그 문장의 원문 조각이다: 줄 안 기호(`**`·`*`·`\*`)는 넣고, 줄의 종류를 정하는 맨 앞 기호(`## `·`> `·문단 줄의 `\`)는 뺀다.
 *   둘 다 발행본에 글자 그대로 있는 조각이라 서버의 수정 제안 검사를 지나고, 맨 앞 기호를 빼 두면 고친 문장을 반영해도 줄의 종류가 바뀌지 않는다.
 * - 서식 없는 글의 문장 나눔과 t는 서식을 들이기 전과 같다.
 */
export function readerBody(paras: string[]): { paragraphs: Sentence[][]; blocks: ReaderBlock[] } {
  const body = paras.join('\n\n')
  const paragraphs: Sentence[][] = paras.map(() => [])
  let offset = 0
  const starts = paras.map((p) => { const at = offset; offset += p.length + 2; return at })
  let pi = 0
  const blocks = manuscriptBlocks(body).map((block): ReaderBlock => {
    if (!('lines' in block)) return block
    // 블록은 빈 줄을 넘지 않으므로 한 덩어리 안에 있다.
    while (starts[pi + 1] <= block.start) pi++
    const sentences: ShownSentence[] = []
    let prev = block.start
    // 문단은 전처럼 블록 전체에서 나눠 문장이 줄을 넘을 수 있다. 인용은 줄마다 나눠 보내는 글에 다음 줄의 `> `가 섞이지 않게 한다.
    const units = block.kind === 'paragraph' ? [paragraphUnit(block.lines, block.start, starts[pi], starts[pi] + paras[pi].length)] : block.lines
    for (const s of units.flatMap(cutSentences)) {
      paragraphs[pi].push({ t: body.slice(s.start, s.end), pi })
      sentences.push({ gap: '\n'.repeat(body.slice(prev, s.start).split('\n').length - 1) || (sentences.length ? ' ' : ''), parts: s.parts })
      prev = s.end
    }
    return { kind: block.kind, sentences }
  })
  return { paragraphs, blocks }
}

/** 목업 reader() body: 문단을 문장으로 나눕니다. */
export const splitSentences = (paras: string[]): Sentence[][] => readerBody(paras).paragraphs

/*
 * 설정 카드 본문(마크다운 문자열)의 순수 규칙: `#`·`##`·`###` 제목 줄로 문단 나누기·목차 번호, 한 줄 요약용으로 기호 벗기기.
 * 공개 카드 페이지의 번호 문단·목차와 독자 설정 위키가 같은 규칙을 쓴다. 목차는 본문의 `#`·`##`·`###` 제목이다.
 */

/** `level`은 제목의 `#` 개수(1~3), 첫 제목 앞 첫머리는 0이고 제목이 비었다. */
export type CardSection = { title: string; body: string; level: number }
/** 번호를 매긴 제목 문단: `no`는 `1`·`1.1`·`1.1.1`, `depth`는 목차의 들여쓰기 단계(1부터). */
export type NumberedCardSection = CardSection & { no: string; depth: number }

/** 코드 울타리 줄(``` 또는 ~~~). 1은 울타리 글자, 2는 그 뒤(여는 줄의 언어 이름·닫는 줄은 비어야 한다). */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
/** 문단을 나누는 줄: `#`·`##`·`###`와 제목(닫는 `#`은 뗀다). `####` 이하·`##제목`(공백 없음)·제목 없는 줄은 나누지 않고 본문에 남는다. */
const SECTION = /^ {0,3}(#{1,3})[ \t]+(\S.*?)(?:[ \t]+#+)?[ \t]*$/

/**
 * 본문을 마크다운 제목 `#`·`##`·`###` 줄마다 한 문단으로 나눈다(목차는 `###`까지, `####` 이하는 문단 본문 안의 소제목으로 남는다).
 * 첫 제목 앞의 내용(제목이 없으면 본문 전체)은 제목이 빈(`''`, 단계 0) 첫머리 문단이고(개요 같은 제목을 지어 붙이지 않는다), 코드 블록 안의 제목 줄은 나누지 않는다.
 * 닫히지 않은 코드 블록은 끝까지 코드다. 본문이 빈 문단은 빼되, 바로 아래 단계 제목이 이어지는 빈 상위 제목은 목차의 부모라 남긴다.
 */
export function splitCardSections(text: string): CardSection[] {
  const raw: CardSection[] = []
  let current: CardSection = { title: '', body: '', level: 0 }
  let lines: string[] = []
  let fence = '' // 열려 있는 울타리(그 줄의 울타리 글자 전부)
  const close = () => raw.push({ ...current, body: lines.join('\n').trim() })
  for (const line of text.split(/\r?\n/)) {
    const [, mark = '', rest = ''] = FENCE.exec(line) ?? []
    if (mark) {
      if (!fence) fence = mark
      else if (mark[0] === fence[0] && mark.length >= fence.length && !rest.trim()) fence = ''
    }
    const heading = fence || mark ? null : SECTION.exec(line)
    if (heading) {
      close()
      current = { title: heading[2], body: '', level: heading[1].length }
      lines = []
    } else lines.push(line)
  }
  close()
  return raw.filter((s, i) => s.body || (s.level > 0 && (raw[i + 1]?.level ?? 0) > s.level))
}

/**
 * 제목 문단에 목차 번호를 매긴다: 단계가 깊어지면 `1.1`, 같은 단계면 다음 번호. 가장 얕은 제목이 1단계이고(`#`가 없어도), 건너뛴 단계(`#` 다음 `###`)는 한 단계로 친다.
 * 첫머리(단계 0)는 번호가 없어 뺀다.
 */
export function numberCardSections(sections: CardSection[]): NumberedCardSection[] {
  const stack: { level: number; n: number }[] = []
  return sections.filter((s) => s.level > 0).map((s) => {
    let last = 0
    while (stack.length && stack[stack.length - 1].level >= s.level) last = stack.pop()!.n
    stack.push({ level: s.level, n: last + 1 })
    return { ...s, no: stack.map((x) => x.n).join('.'), depth: stack.length }
  })
}

/** 줄 전체가 기호인 줄(코드 울타리·구분선·표의 구분 줄)은 요약에서 버린다. */
const BARE = /^\s*(?:(?:`{3,}|~{3,}).*|([-*_])(?:\s*\1){2,}\s*|\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*)$/
/** 줄 앞의 제목·인용·목록 기호 하나(제목 안의 `1.`은 목록이 아니라 제목 글자라 하나만 벗긴다). */
const LEADING = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/
/** 줄 안의 기호를 글자만 남기는 규칙(앞에서부터 차례로). 밑줄은 단어 안(`snake_case`)에서는 기호가 아니다. */
const INLINE: [RegExp, string][] = [
  [/!\[([^\]]*)\]\([^)]*\)/g, '$1'],
  [/\[([^\]]*)\]\([^)]*\)/g, '$1'],
  [/`([^`]+)`/g, '$1'],
  [/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2'],
  [/\*(?=\S)(.+?)(?<=\S)\*/g, '$1'],
  [/(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, '$1'],
  [/~~(?=\S)(.+?)(?<=\S)~~/g, '$1'],
]

/**
 * 본문을 한 줄로 보이는 곳(게시판 요약 열 등)에 쓸 일반 글자로 바꾼다: 제목·목록·인용·굵게·기울임·취소선·링크·이미지·코드·표 선 기호를 벗기고 줄은 한 칸으로 잇는다.
 * ponytail: 파서가 아니라 요약용 근사 규칙이라 겹친 기호(인용 속 목록 등)는 바깥 하나만 벗긴다. 정확한 변환이 필요하면 마크다운 파서로 글자만 뽑는다.
 */
export function plainCardText(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !BARE.test(line))
    .map((line) => {
      const bare = /^\s*\|/.test(line) ? line.replaceAll('|', ' ') : line // 표 줄의 세로선
      return INLINE.reduce((s, [pattern, to]) => s.replace(pattern, to), bare.replace(LEADING, ''))
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

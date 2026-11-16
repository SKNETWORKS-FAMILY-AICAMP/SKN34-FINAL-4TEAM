/*
 * 설정 카드 본문(마크다운 문자열)의 순수 규칙: `## 제목` 줄로 문단 나누기, 한 줄 요약용으로 기호 벗기기.
 * 공개 카드 페이지의 번호 문단·목차와 내 세계관 편집 화면의 미리보기가 같은 규칙을 써서 문단 번호까지 같다.
 */

export type CardSection = { title: string; body: string }

/** 코드 울타리 줄(``` 또는 ~~~). 1은 울타리 글자, 2는 그 뒤(여는 줄의 언어 이름·닫는 줄은 비어야 한다). */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
/** 문단을 나누는 줄: 정확히 `##`와 제목. `#`·`###`·`##제목`(공백 없음)·제목 없는 `##`는 나누는 줄이 아니다. */
const SECTION = /^ {0,3}##[ \t]+(\S.*?)[ \t]*$/

/**
 * 본문을 `## 제목` 줄마다 한 문단으로 나눈다. 첫 `##` 앞의 내용(`##`가 없으면 본문 전체)은 '개요'이고, 코드 블록 안의 `##`는 나누지 않는다.
 * 닫히지 않은 코드 블록은 끝까지 코드다. 내용이 비었거나 공백뿐인 문단은 뺀다.
 */
export function splitCardSections(text: string): CardSection[] {
  const sections: CardSection[] = []
  let title = '개요'
  let lines: string[] = []
  let fence = '' // 열려 있는 울타리(그 줄의 울타리 글자 전부)
  const close = () => {
    const body = lines.join('\n').trim()
    if (body) sections.push({ title, body })
  }
  for (const line of text.split(/\r?\n/)) {
    const [, mark = '', rest = ''] = FENCE.exec(line) ?? []
    if (mark) {
      if (!fence) fence = mark
      else if (mark[0] === fence[0] && mark.length >= fence.length && !rest.trim()) fence = ''
    }
    const heading = fence || mark ? null : SECTION.exec(line)
    if (heading) {
      close()
      title = heading[1]
      lines = []
    } else lines.push(line)
  }
  close()
  return sections
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

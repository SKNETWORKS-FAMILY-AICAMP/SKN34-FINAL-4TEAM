/*
 * 설정 카드 본문 링크 `[글자](card:<uuid>)`(DEC-53, docs/design/worldstudio-independent-schema.md '카드 본문 링크')의 문법 하나다.
 * 줄·코드·이스케이프 같은 마크다운 문맥을 보지 않고 본문을 통째로 훑는다(코드 안의 것도 링크). 서버(Kotlin)·AI 입력 경계(Python)가 같은 정규식과 검증 표를 따로 구현한다.
 * 글자 길이는 UTF-16 단위로 센다(`u` 플래그를 쓰지 않는다). 링크는 본문이 그 카드를 말했다는 언급일 뿐이고 정의된 연결은 관계(Neo4j)가 맡는다.
 */
const UUID = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'
const CARD_LINK = new RegExp(`\\[([^\\[\\]\\r\\n]{1,200})\\]\\(card:(${UUID})\\)`, 'g')
const CARD_HREF = new RegExp(`^card:(${UUID})$`)
/** 링크 글자의 최대 길이(UTF-16 단위) */
const LABEL_MAX = 200

/** `id`는 늘 소문자다(카드 id를 견줄 때 대소문자를 가리지 않는다). */
export type CardLink = { text: string; id: string }

/** 본문 안의 링크를 앞에서부터 모두 돌려준다. */
export const cardLinks = (text: string): CardLink[] => Array.from(text.matchAll(CARD_LINK), ([, label, id]) => ({ text: label, id: id.toLowerCase() }))

/** 링크마다 [to]가 돌려주는 글로 바꾼다. 링크가 아닌 곳은 그대로다. */
export const replaceCardLinks = (text: string, to: (link: CardLink) => string): string =>
  text.replace(CARD_LINK, (_, label: string, id: string) => to({ text: label, id: id.toLowerCase() }))

/** 모든 링크를 글자로 바꾼다. 점검처럼 링크의 id가 글자에 섞이면 안 되는 곳과 가져올 때 대상이 없는 링크에 쓴다. */
export const stripCardLinks = (text: string): string => replaceCardLinks(text, ({ text: label }) => label)

/** 링크 주소(`card:<uuid>`)이면 소문자 id, 아니면 undefined. 렌더러가 마크다운 링크의 href를 읽을 때 쓴다. */
export const cardLinkId = (href: string | undefined): string | undefined => CARD_HREF.exec(href ?? '')?.[1].toLowerCase()

/**
 * 삽입할 링크 글: `[글자](card:<id>)`. 글자는 [labels] 가운데 `[`·`]`·줄바꿈을 빼고 앞뒤 공백을 뗀 뒤 비지 않은 첫 값(선택한 글자, 없으면 대상 제목)이고 아무것도 없으면 '설정'이다.
 * 200자(UTF-16)를 넘으면 자르되 서로게이트 쌍의 앞 글자만 남기지 않는다.
 */
export function cardLinkMarkdown(id: string, ...labels: string[]): string {
  const label = labels.map((value) => value.replace(/[[\]\r\n]/g, '').trim()).find(Boolean) ?? '설정'
  return `[${label.slice(0, LABEL_MAX).replace(/[\uD800-\uDBFF]$/, '')}](card:${id})`
}

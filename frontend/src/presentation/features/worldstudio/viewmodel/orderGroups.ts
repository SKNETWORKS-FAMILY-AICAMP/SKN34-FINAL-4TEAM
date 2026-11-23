import type { OrderIssue } from '../../../../domain/entities/worldReview'

/** 같은 카드의 이름이 나온 경고 묶음: `detail`은 카드 이름 뒤의 한 줄, `summary`는 `이름 — detail`, `issues`는 펼침 상세용 경고 전부다. */
export type OrderGroup = { cardId: string; title: string; detail: string; summary: string; issues: OrderIssue[] }

/** 한 줄에 쓰는 회차의 최대 수: 넘치면 `1·2·3·4·5·6 외 4화`처럼 나머지 수만 알린다. */
const EPISODES_MAX = 6

/**
 * 공개 순서 경고를 이름이 나온 카드별로 묶는다(같은 카드 이름이 본문·관계 글에 되풀이돼 수십 줄이 되는 것을 한 줄로):
 * `위즐리네 캠프장 — 64화부터 공개 · 본문 1 · 관계 글 5곳 (17·20·23·40·62화)`. 없는 종류는 쓰지 않고, 관계 글은 관계 하나가 한 곳이다(같은 관계가 이름을 두 번 불러도).
 * 경고가 많은 카드가 먼저, 같으면 이름 순이다.
 */
export function groupOrderIssues(issues: readonly OrderIssue[]): OrderGroup[] {
  const groups = new Map<string, OrderIssue[]>()
  for (const issue of issues) (groups.get(issue.named.cardId) ?? groups.set(issue.named.cardId, []).get(issue.named.cardId)!).push(issue)
  return [...groups.values()].map((list) => {
    const { named } = list[0], title = named.title || '이름 없는 설정'
    const bodies = list.filter((i) => i.source === 'body').length
    const relations = new Map(list.filter((i) => i.source === 'relation').map((i) => [i.relationId, i.visibleFrom]))
    const episodes = [...new Set(relations.values())].sort((a, b) => a - b)
    const shown = episodes.slice(0, EPISODES_MAX).join('·') + (episodes.length > EPISODES_MAX ? ` 외 ${episodes.length - EPISODES_MAX}` : '')
    const detail = [named.from === undefined ? '작가 전용' : `${named.from}화부터 공개`, bodies && `본문 ${bodies}`, relations.size && `관계 글 ${relations.size}곳 (${shown}화)`].filter(Boolean).join(' · ')
    return { cardId: named.cardId, title, detail, summary: `${title} — ${detail}`, issues: list }
  }).sort((a, b) => b.issues.length - a.issues.length || a.title.localeCompare(b.title, 'ko'))
}

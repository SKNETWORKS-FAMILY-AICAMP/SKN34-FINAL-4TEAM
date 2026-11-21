import { relationHistoryLine } from './relationParagraph'
import { KINDS, type CardKind } from './worldBoard'

/*
 * 카드별 관계도(순수): 가운데 카드 한 장에 이어진 관계를 이웃별로 묶고 그림에 둘 이웃·회차 탭 값을 정한다. 작가 편집 화면과 공개 카드 페이지가 함께 쓴다(입력은 두 화면의 어댑터가 만든다).
 * 같은 상대와의 관계가 여럿이면 하나로 묶어 가장 늦은 회차의 관계 이름(+외 N)을 보이고, 이력은 공개 화면의 `relationHistoryLine` 표기(`경계(1화) → 보호(3화)`)를 쓴다.
 */

/** 그림의 둘레에 두는 이웃의 상한: 넘치면 '외 N개'로 알리고 아래 목록에 모두 있다. */
export const RING_MAX = 16

/** 관계 이름이 `episode`화부터 `name`이다(회차를 모르면 null). 한 관계의 이름이 바뀐 이력이면 여러 개다. */
export type RelationStep = { name: string; episode: number | null }
/** 가운데 카드에서 본 관계 한 줄: 상대 카드와 그 관계의 이름 이력(회차 오름차순, 마지막이 현재). */
export type RelationEntry = { id: string; otherId: string; otherTitle: string; otherKind: CardKind; steps: readonly RelationStep[] }
/** 이웃 한 명: 그 상대와의 관계들을 묶은 것. `name`은 가장 늦은 회차의 관계 이름, `more`는 나머지 관계 수, `weight`는 관계 수·바뀐 횟수, `first`는 처음 이어진 회차다. */
export type Neighbor = { id: string; title: string; kind: CardKind; entries: RelationEntry[]; name: string; more: number; history: string; weight: number; first: number | null }

const latest = (e: RelationEntry) => e.steps[e.steps.length - 1]
const at = (episode: number | null) => episode ?? -1

/** 탭 값: 관계가 생기거나 바뀌는 회차의 서로 다른 값(오름차순, 회차를 모르는 것은 뺀다). */
export const episodeTabs = (entries: readonly RelationEntry[]) => [...new Set(entries.flatMap((e) => e.steps.flatMap((s) => (s.episode === null ? [] : [s.episode]))))].sort((a, b) => a - b)

/** `episode`화 시점의 관계: 그 회차까지 생긴 관계만 남고 이름 이력도 그 회차까지다. null이면 전체이고, 회차를 모르는 관계는 늘 남는다. */
export function atEpisode(entries: readonly RelationEntry[], episode: number | null): RelationEntry[] {
  if (episode === null) return [...entries]
  return entries.flatMap((e) => {
    const steps = e.steps.filter((s) => s.episode === null || s.episode <= episode)
    return steps.length ? [{ ...e, steps }] : []
  })
}

/** 같은 상대의 관계를 이웃 하나로 묶는다(처음 나온 순서). */
export function groupNeighbors(entries: readonly RelationEntry[]): Neighbor[] {
  const groups = new Map<string, RelationEntry[]>()
  for (const e of entries) (groups.get(e.otherId) ?? groups.set(e.otherId, []).get(e.otherId)!).push(e)
  return [...groups].map(([id, list]) => {
    const rep = list.reduce((best, e) => (at(latest(e).episode) >= at(latest(best).episode) ? e : best))
    const steps = list.flatMap((e) => e.steps).flatMap((s) => (s.episode === null ? [] : [{ name: s.name, episode: s.episode }])).sort((a, b) => a.episode - b.episode)
    return {
      id, title: list[0].otherTitle, kind: list[0].otherKind, entries: list, name: latest(rep).name, more: list.length - 1,
      history: relationHistoryLine(null, steps.map((s) => ({ episode: s.episode, label: s.name, body: '' }))),
      weight: list.reduce((sum, e) => sum + e.steps.length, 0), first: steps.length ? steps[0].episode : null,
    }
  })
}

const byWeight = (a: Neighbor, b: Neighbor) => b.weight - a.weight || a.title.localeCompare(b.title, 'ko')
/**
 * 그림에 둘 이웃(`ring`): 사건이 아닌 이웃을 관계 수·바뀐 횟수가 많은 순으로 16개까지 뽑아 유형별로 모은다(인물 먼저). `rest`는 둘레에 못 둔 수다.
 * `people`은 사건이 아닌 모든 이웃(목록용, 유형 묶음 순·묶음 안은 많은 순)이고 사건(`events`)은 처음 이어진 회차 순이다(회차를 모르면 뒤).
 */
export function layoutOf(neighbors: readonly Neighbor[]) {
  const others = neighbors.filter((n) => n.kind !== '사건')
  const grouped = (list: readonly Neighbor[]) => KINDS.flatMap((kind) => list.filter((n) => n.kind === kind))
  const ring = grouped([...others].sort(byWeight).slice(0, RING_MAX))
  const events = neighbors.filter((n) => n.kind === '사건').sort((a, b) => (a.first ?? Infinity) - (b.first ?? Infinity) || a.title.localeCompare(b.title, 'ko'))
  return { ring, rest: others.length - ring.length, people: grouped([...others].sort(byWeight)), events }
}

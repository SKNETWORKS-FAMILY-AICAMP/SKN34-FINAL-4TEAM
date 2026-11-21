import { relationHistoryLine } from './relationParagraph'
import { textWidth } from './textWidth'
import { KINDS, type CardKind } from './worldBoard'

/*
 * 카드별 관계도(순수): 가운데 카드 한 장에 이어진 관계를 이웃별로 묶고 그림에 둘 이웃·회차 탭 값을 정한다. 작가 편집 화면과 공개 카드 페이지가 함께 쓴다(입력은 두 화면의 어댑터가 만든다).
 * 같은 상대와의 관계가 여럿이면 하나로 묶어 가장 늦은 회차의 관계 이름(+외 N)을 보이고, 이력은 공개 화면의 `relationHistoryLine` 표기(`경계(1화) → 보호(3화)`)를 쓴다.
 */

/** 그림의 둘레에 두는 이웃의 상한: 넘치면 '외 N개'로 알리고 아래 목록에 모두 있다. */
export const RING_MAX = 16

/** 관계 이름이 `episode`화부터 `name`이다(회차를 모르면 null). 한 관계의 이름이 바뀐 이력이면 여러 개다. `body`는 그 시점의 관계 본문(설명 문장)이고 목록을 펼칠 때만 보인다. */
export type RelationStep = { name: string; episode: number | null; body?: string }
/** 가운데 카드에서 본 관계 한 줄: 상대 카드와 그 관계의 이름 이력(회차 오름차순, 마지막이 현재). */
export type RelationEntry = { id: string; otherId: string; otherTitle: string; otherKind: CardKind; steps: readonly RelationStep[] }
/** 이웃 한 명: 그 상대와의 관계들을 묶은 것. `name`은 가장 늦은 회차의 관계 이름, `more`는 나머지 관계 수, `weight`는 관계 수·바뀐 횟수, `first`는 처음 이어진 회차, `notes`는 관계마다 현재 본문(이름과 함께, 같은 본문은 한 번)이다. */
export type Neighbor = { id: string; title: string; kind: CardKind; entries: RelationEntry[]; name: string; more: number; history: string; weight: number; first: number | null; notes: { name: string; body: string }[] }

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

/**
 * 같은 상대의 관계를 이웃 하나로 묶는다(처음 나온 순서). 대표 이름은 가장 늦은 회차의 관계 이름인데, `quiet`(알고 있음 같은 조용한 종류)가 아닌 관계가 있으면 그 가운데서 고른다
 * (늦은 회차의 '알고 있음'이 앞선 '형제'를 가리지 않게).
 */
export function groupNeighbors(entries: readonly RelationEntry[], quiet: readonly string[] = []): Neighbor[] {
  const groups = new Map<string, RelationEntry[]>()
  for (const e of entries) (groups.get(e.otherId) ?? groups.set(e.otherId, []).get(e.otherId)!).push(e)
  return [...groups].map(([id, list]) => {
    const calm = list.filter((e) => !quiet.includes(latest(e).name)), pool = calm.length ? calm : list
    const rep = pool.reduce((best, e) => (at(latest(e).episode) >= at(latest(best).episode) ? e : best))
    const steps = list.flatMap((e) => e.steps).flatMap((s) => (s.episode === null ? [] : [{ name: s.name, episode: s.episode }])).sort((a, b) => a.episode - b.episode)
    return {
      id, title: list[0].otherTitle, kind: list[0].otherKind, entries: list, name: latest(rep).name, more: list.length - 1,
      history: relationHistoryLine(null, steps.map((s) => ({ episode: s.episode, label: s.name, body: '' }))),
      weight: list.reduce((sum, e) => sum + e.steps.length, 0), first: steps.length ? steps[0].episode : null,
      notes: list.flatMap((e) => { const { name, body } = latest(e); return body?.trim() ? [{ name, body: body.trim() }] : [] }).filter((note, i, all) => all.findIndex((x) => x.body === note.body) === i),
    }
  })
}

/** 관계 종류(대표 이름) 한 묶음: `quiet`면 알고 있음 같은 조용한 종류라 기본으로 접는다. */
export type KindGroup = { name: string; quiet: boolean; items: Neighbor[] }
/** 이웃을 대표 이름별로 묶는다: 의미 있는 종류는 많은 순(같으면 이름 순)으로 위에, 조용한 종류는 맨 아래에 `quiet` 순서대로. 묶음 안은 들어온 순서다. */
export function kindGroups(neighbors: readonly Neighbor[], quiet: readonly string[]): KindGroup[] {
  const byName = new Map<string, Neighbor[]>()
  for (const n of neighbors) (byName.get(n.name) ?? byName.set(n.name, []).get(n.name)!).push(n)
  const all = [...byName].map(([name, items]) => ({ name, quiet: quiet.includes(name), items }))
  return [
    ...all.filter((g) => !g.quiet).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, 'ko')),
    ...all.filter((g) => g.quiet).sort((a, b) => quiet.indexOf(a.name) - quiet.indexOf(b.name)),
  ]
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

/*
 * 그림의 기하(순수): 상자 크기·둘레 위치·이웃 이름·선 이름. 이웃 이름이 상자 밖으로 잘리지 않게 좌우에 이름 자리를 두고(왼쪽 이웃은 오른쪽 끝을 맞추고 오른쪽 이웃은 왼쪽 끝을 맞춘다)
 * 폭이 모자라면 말줄임으로 줄이며, 선 이름은 선의 바깥쪽에 놓고 겹치면 숨긴다(아래 간단 목록에 모두 있다).
 */
/** 그림 상자(viewBox)와 둘레(타원)의 가로·세로 반지름. 가로로 넓게 잡아 좌우 이웃의 이름 자리를 남긴다. */
export const MAP_W = 640, MAP_H = 360, MAP_RX = 200, MAP_RY = 125
/** 이웃 노드 반지름과 노드~이름 간격, 상자 가장자리 여백(px). */
const NODE_R = 9, TEXT_GAP = 14, EDGE_PAD = 4

/** 글자 수로 줄인다: `max`자를 넘으면 앞 `max`자 뒤에 …를 붙인다. */
export const clip = (text: string, max: number) => (Array.from(text).length > max ? Array.from(text).slice(0, max).join('') + '…' : text)
/** 폭(px)에 들도록 뒤를 …로 줄인다. …도 못 담을 만큼 좁으면 빈 글이다. */
export function ellipsize(text: string, maxWidth: number, size: number) {
  if (textWidth(text, size) <= maxWidth) return text
  const chars = Array.from(text)
  while (chars.length && textWidth(chars.join('') + '…', size) > maxWidth) chars.pop()
  return chars.length ? chars.join('') + '…' : textWidth('…', size) <= maxWidth ? '…' : ''
}

/** 둘레에 놓은 이웃: 노드 중심 좌표와 각도(위가 −π/2, 시계 방향). */
export type Spot = { n: Neighbor; x: number; y: number; angle: number }
/** 이웃을 타원 둘레에 위에서 시계 방향으로 고르게 놓는다. */
export const ringSpots = (ring: readonly Neighbor[]): Spot[] => ring.map((n, i) => {
  const angle = -Math.PI / 2 + (2 * Math.PI * i) / ring.length
  return { n, angle, x: MAP_W / 2 + MAP_RX * Math.cos(angle), y: MAP_H / 2 + MAP_RY * Math.sin(angle) }
})

/** 이웃 이름의 자리: 좌우 이웃은 노드 옆(왼쪽은 end·오른쪽은 start), 위아래 이웃은 노드 위·아래 가운데(middle)이고 폭이 모자라면 말줄임이다. */
export function nodeText({ n, x, y, angle }: Spot, size = 12) {
  const side = Math.cos(angle)
  if (side > 0.3) return { x: x + TEXT_GAP, y: y + 4, anchor: 'start' as const, text: ellipsize(n.title, MAP_W - EDGE_PAD - (x + TEXT_GAP), size) }
  if (side < -0.3) return { x: x - TEXT_GAP, y: y + 4, anchor: 'end' as const, text: ellipsize(n.title, x - TEXT_GAP - EDGE_PAD, size) }
  return { x, y: y + (Math.sin(angle) > 0 ? NODE_R + 17 : -(NODE_R + 7)), anchor: 'middle' as const, text: ellipsize(n.title, 2 * Math.min(x, MAP_W - x) - 2 * EDGE_PAD, size) }
}

/** 선 이름 자리: 가운데에서 노드까지의 65% 지점이다(가운데 근처에 몰리지 않게). */
const EDGE_AT = 0.65
export type EdgeText = { id: string; x: number; y: number; text: string }
/**
 * 선 이름(관계 이름만, 8자 넘으면 말줄임, 외 N은 목록에): 관계가 많은 이웃부터 자리를 잡고 앞서 놓은 이름과 겹치면 숨긴다.
 */
export function edgeTexts(spots: readonly Spot[], size = 11): EdgeText[] {
  const placed: { l: number; r: number; t: number; b: number }[] = [], shown: EdgeText[] = []
  for (const { n, x, y } of [...spots].sort((a, b) => b.n.weight - a.n.weight)) {
    const text = clip(n.name, 8), cx = MAP_W / 2 + (x - MAP_W / 2) * EDGE_AT, cy = MAP_H / 2 + (y - MAP_H / 2) * EDGE_AT
    const half = textWidth(text, size) / 2 + 3, box = { l: cx - half, r: cx + half, t: cy - size, b: cy + 4 }
    if (placed.some((p) => box.l < p.r && p.l < box.r && box.t < p.b && p.t < box.b)) continue
    placed.push(box)
    shown.push({ id: n.id, x: cx, y: cy, text })
  }
  return shown
}

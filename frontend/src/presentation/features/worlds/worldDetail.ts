import { cardLinks } from '../../../domain/entities/cardLinks'
import type { PublicWorld, PublicWorldRelationship } from '../../../domain/entities/publicWorld'
import { cardTypes, type CardType } from '../../../domain/entities/studioCards'
import { plainCardText } from '../../shared/cardSections'
import { relationName, showsParagraph } from '../../shared/relationParagraph'
import { CARD_COLORS, CARD_KIND, KINDS, boardRows, type BoardEntry, type BoardRow, type CardKind } from '../../shared/worldBoard'
import { genreLabel } from '../../shared/worldGenres'
import { GENRE_COLORS } from './worldAtlas'
import { pageItems } from '../../shared/pageItems'

/*
 * 공개 세계관 상세(`/worlds/:id`)와 설정 카드 페이지(`/worlds/:id/cards/:cardId`)의 순수 규칙: 설정 그래프·인물관계도의 노드·링크,
 * 설정집 게시판(유형·검색어 필터, 정렬, 번호), 카드 한 장의 페이지(관계·연관·역방향 연관·같은 유형·이전/다음).
 *
 * 공개 세계관 상세 API(`GET /api/v1/public/world-studios/{id}`)의 카드와 현재 관계(양 끝 카드 id)를 그래프·카드 페이지로 바꾼다. 카드 페이지 주소의 cardId는 카드 id다.
 * 관계 중 인물↔인물은 인물관계도(라벨이 관계)가, 그 밖은 설정 연관이 된다. 관계 상태가 `unavailable`이면 서버가 관계를 비워 주므로 연결이 없는 그래프가 된다(화면이 따로 알린다).
 * 관계 `A → B 「관계명」`은 "B는 A의 관계명"으로 읽는다(DEC-54): 보내는 쪽(A)에는 `B — 관계명` 문단이, 단방향이면 받는 쪽(B)에는 '이 설정을 가리키는 관계'의 링크만 있고 대칭·방향 미상은 양쪽 모두 문단이다.
 * 같은 카드 쌍의 관계도 ID마다 보존한다.
 * 카드 본문의 링크(`[글자](card:<uuid>)`, DEC-53)로 이 카드를 가리킨 카드도 '가리키는 설정'이다(서버가 보이는 카드로만 링크를 남기고, 화면이 받은 본문으로 계산한다).
 */

export const DETAIL_TABS = [['graph', '설정 그래프'], ['people', '인물관계도'], ['book', '설정집'], ['overview', '개요']] as const
export type DetailTab = (typeof DETAIL_TABS)[number][0]
/** `?tab=` 값. 없거나 모르는 값이면 첫 탭(설정 그래프)이다. */
export const parseDetailTab = (value: string | null): DetailTab => DETAIL_TABS.find(([key]) => key === value)?.[0] ?? 'graph'

/** 설정 카드 페이지 주소. `cardId`는 서버 카드 id다. */
export const cardPath = (worldId: string, cardId: string | number) => `/worlds/${worldId}/cards/${cardId}`
/** 설정집 게시판의 '보이는 설정 모두 선택': 켜면 보이는 줄을 앞서 고른 것에 더하고, 끄면 보이는 줄만 선택에서 뺀다(필터에 가려진 선택은 남는다). */
export const selectVisible = (selected: ReadonlySet<string>, visible: readonly string[], on: boolean): Set<string> =>
  new Set(on ? [...selected, ...visible] : [...selected].filter((id) => !visible.includes(id)))
/** 공개 카드 대표 이미지 주소(#401): 서버는 공개 세계관의 확정 버전에서 공개·활성 카드가 가리키는 이미지만 준다. */
export const cardImageSrc = (worldId: string, imageId: string) => `/api/v1/public/world-studios/${encodeURIComponent(worldId)}/card-images/${encodeURIComponent(imageId)}`
/** 설정집 탭 주소. `kind`를 주면 그 유형 칩이 골라진 채로 열린다(`?type=`). */
export const bookPath = (worldId: string, kind?: CardKind) => `/worlds/${worldId}?${new URLSearchParams({ tab: 'book', ...(kind ? { type: kind } : {}) })}`

type RelationData = Pick<PublicWorldRelationship, 'category' | 'direction' | 'body' | 'polarity' | 'history'>
type CardPair = { id: string; a: number; b: number; label?: string } & RelationData
/**
 * 카드 위치 쌍으로 본 카드 연관. 양 끝 카드가 없는 관계·자기 참조는 버리고 각 관계 ID를 보존한다.
 * `a`는 관계의 출발(source) 카드, `b`는 도착(target)이고 빈 라벨은 라벨 없음이다. 그래프 링크와 카드 페이지의 연관 목록이 모두 이 결과를 쓴다.
 */
export function cardPairs(world: PublicWorld): CardPair[] {
  const at = new Map(world.cards.map((c, i) => [c.id, i]))
  const pairs: CardPair[] = []
  for (const { id, sourceCardId, targetCardId, label, category, direction, body, polarity } of world.relationships) {
    const a = at.get(sourceCardId)
    const b = at.get(targetCardId)
    if (a === undefined || b === undefined || a === b) continue
    pairs.push({ id, a, b, label: label || undefined, ...(category !== undefined && { category }), ...(direction !== undefined && { direction }), ...(body !== undefined && { body }), ...(polarity !== undefined && { polarity }) })
  }
  return pairs
}

/**
 * 본문 링크로 이어진 카드 쌍 `[건 카드, 가리킨 카드]`의 위치다. 응답 안의 카드끼리만 잇고(서버가 보이지 않는 대상의 링크는 글자로 바꿔 보냈다), 없는 대상·자기 자신·같은 카드를 여러 번 건 것은 한 번만 센다.
 * 관계(`pairs`)로 이미 이어진 두 카드는 관계 쪽이 그 연결을 보이므로 뺀다(연결 수를 두 번 세지 않는다).
 */
function linkPairs(world: PublicWorld, pairs: readonly CardPair[]): [from: number, to: number][] {
  const n = world.cards.length
  const at = new Map(world.cards.map((c, i) => [c.id, i]))
  const related = new Set(pairs.map(({ a, b }) => Math.min(a, b) * n + Math.max(a, b)))
  const seen = new Set<number>()
  const found: [number, number][] = []
  world.cards.forEach(({ text }, from) => {
    if (!text.includes('](card:')) return // 링크가 없는 본문은 훑지 않는다
    for (const { id } of cardLinks(text)) {
      const to = at.get(id)
      if (to === undefined || to === from || related.has(Math.min(from, to) * n + Math.max(from, to)) || seen.has(from * n + to)) continue
      seen.add(from * n + to)
      found.push([from, to])
    }
  })
  return found
}

type Pos = { x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number }
/** `kind`는 중심이면 '세계관', 카드면 유형 묶음(색·범례와 같은 이름)이다. `to`는 노드를 누르면 갈 주소(카드는 카드 페이지, 중심은 설정집 탭)다. */
export type DetailNode = Pos & { id: string; name: string; kind: '세계관' | CardKind; color: string; to: string }
/** `world`는 중심→카드의 옅은 선, `link`는 카드끼리의 연관이다(인물끼리는 `label`이 관계). `source`·`target`은 ForceGraph가 노드 객체로 바꾼다. */
export type DetailLink = { id?: string; source: string | DetailNode; target: string | DetailNode; kind: 'world' | 'link'; label?: string; curve?: number } & RelationData
export type DetailGraph = { nodes: DetailNode[]; links: DetailLink[] }

export const detailEndpoint = (end: string | DetailNode) => (typeof end === 'string' ? end : end.id)

/** 한 페이지의 양 끝이 보이는 선만 그린다. 전체 연결은 카드 상세에서 볼 수 있다. */
export function graphPage(graph: DetailGraph, page: number, size: number): DetailGraph {
  const center = graph.nodes.filter((n) => n.kind === '세계관')
  const nodes = [...pageItems(graph.nodes.filter((n) => n.kind !== '세계관'), page, size).items, ...center]
  const ids = new Set(nodes.map((n) => n.id))
  return { nodes, links: graph.links.filter((l) => ids.has(detailEndpoint(l.source)) && ids.has(detailEndpoint(l.target))) }
}

/** 선택한 카드의 인접 카드를 페이지별로 보여 준다. 서로 다른 원래 페이지의 끝점도 함께 그린다. */
export function graphNeighbors(graph: DetailGraph, anchor: string, page: number, size: number): DetailGraph {
  const center = graph.nodes.find((n) => n.id === anchor)
  if (!center) return { nodes: [], links: [] }
  const links = graph.links.filter((l) => l.kind === 'link' && (detailEndpoint(l.source) === anchor || detailEndpoint(l.target) === anchor))
  const neighborIds = new Set(links.map((l) => detailEndpoint(l.source) === anchor ? detailEndpoint(l.target) : detailEndpoint(l.source)))
  const neighbors = pageItems(graph.nodes.filter((n) => neighborIds.has(n.id)), page, size).items
  const ids = new Set([anchor, ...neighbors.map((n) => n.id)])
  return { nodes: [center, ...neighbors], links: links.filter((l) => ids.has(detailEndpoint(l.source)) && ids.has(detailEndpoint(l.target))) }
}

const cardNode = (world: PublicWorld, i: number): DetailNode => {
  const { id, title, cardType } = world.cards[i]
  const kind = CARD_KIND[cardType]
  return { id: `card:${id}`, name: title, kind, color: CARD_COLORS[kind], to: cardPath(world.id, id) }
}
const pairLink = (world: PublicWorld, { id, a, b, label, category, direction, polarity }: CardPair): DetailLink => ({ id, source: `card:${world.cards[a].id}`, target: `card:${world.cards[b].id}`, kind: 'link', label, ...(category !== undefined && { category }), ...(direction !== undefined && { direction }), ...(polarity !== undefined && { polarity }) })

/**
 * 설정 그래프: 카드 노드 + 세계관 중심 노드. 호출마다 새 객체를 만든다(ForceGraph가 노드에 좌표를 붙이고 링크 끝점을 노드 객체로 바꾼다).
 * 중심을 맨 뒤에 두어 큰 노드와 그 이름이 카드 위에 그려지고 클릭도 먼저 받는다.
 */
export function buildSettingGraph(world: PublicWorld): DetailGraph {
  const cards = world.cards.map((_, i) => cardNode(world, i))
  const center: DetailNode = { id: 'world', name: world.name, kind: '세계관', color: GENRE_COLORS[genreLabel(world.genre)], to: bookPath(world.id) }
  return {
    nodes: [...cards, center],
    links: [...cards.map((n): DetailLink => ({ source: center.id, target: n.id, kind: 'world' })), ...cardPairs(world).map((pair) => pairLink(world, pair))],
  }
}

/** 인물관계도: 인물 카드만 노드, 인물끼리의 연관만 링크(`label`이 관계). 인물이 둘 미만이면 링크가 없고 화면이 빈 상태를 보인다. */
export function buildCharacterGraph(world: PublicWorld): DetailGraph {
  const person = (i: number) => world.cards[i].cardType === 'character'
  return {
    nodes: world.cards.flatMap((_, i) => (person(i) ? [cardNode(world, i)] : [])),
    links: cardPairs(world).filter((p) => person(p.a) && person(p.b)).map((pair) => pairLink(world, pair)),
  }
}

/** 이름을 늘 그려도 겹치지 않는 노드 수의 한계. 넘으면 세계관(중심)과 마우스를 올린 노드만 그린다. */
export const LABEL_ALL_MAX = 30
export const showsDetailLabel = (node: DetailNode, total: number, hover?: string) => total <= LABEL_ALL_MAX || node.kind === '세계관' || node.id === hover

export const typeLabel = (type: CardType) => cardTypes.find((t) => t.id === type)?.label ?? type

/**
 * 다른 카드를 가리키는 값. `type`은 카드 자신의 유형 이름(능력·사물 …), `kind`는 묶음(색·범례·설정집 섹션)이고 `label`은 이어 준 관계의 관계명이다(「동일 인물」은 늘 '동일 인물').
 * `relationId`는 관계의 id다(본문 링크·같은 유형 목록에는 없다). 관계 문단의 앵커는 문단을 가진 카드와 이 id로 정한다(`relationAnchor`).
 */
export type CardRef = { cardId: string; title: string; type: string; kind: CardKind; label?: string; relationId?: string } & RelationData
const cardRef = (world: PublicWorld, i: number, label?: string): CardRef => {
  const { id, title, cardType } = world.cards[i]
  return { cardId: id, title, type: typeLabel(cardType), kind: CARD_KIND[cardType], ...(label ? { label } : {}) }
}

/** 설정집 순서: 유형 묶음(인물·장소·조직·규칙·사건·기타) 순, 같은 묶음 안에서는 카드 순서. 값은 `world.cards`의 위치다. */
const bookOrder = (world: PublicWorld) => KINDS.flatMap((kind) => world.cards.flatMap((c, i) => (CARD_KIND[c.cardType] === kind ? [i] : [])))

export type CardPage = {
  /** `text`는 마크다운 원문 그대로다(화면이 `#`·`##`·`###` 제목 문단으로 나눠 그린다). `imageId`는 대표 이미지가 있을 때만 있다. */
  card: CardRef & { text: string; aliases: string[]; tags: string[]; imageId?: string }
  /** 인물의 소속: 어느 쪽이 썼든 이어진 조직 카드(같은 조직은 먼저 쓴 관계 하나). 인물이 아니면 빈 목록이다. */
  affiliations: CardRef[]
  /** 이 카드에 문단으로 보이는 관계(DEC-54): 이 카드가 보내는 관계와 방향이 대칭이거나 없는(미상) 관계. 관계마다 하나이고 같은 상대는 기록 순서다. */
  relations: (CardRef & { relationId: string })[]
  /** 이 카드를 가리키는 관계: 다른 카드가 이 카드로 보낸 단방향 관계(`cardId`는 보내는 쪽 카드)와, 본문 링크로 이 카드를 가리킨 카드(`본문 링크`, 관계 id 없음). */
  backlinks: CardRef[]
  /** 같은 유형 묶음의 다른 카드 */
  sameType: CardRef[]
  /** 세계관 전체를 설정집 순서로 이은 앞·뒤 카드 */
  prev?: CardRef
  next?: CardRef
}

/**
 * `me`번 카드의 페이지 내용. 이 카드에 닿는 관계(양 끝 카드가 있고 자기 참조가 아닌 것)는 관계마다 하나씩, 상대 카드의 설정집 순서로(같은 상대는 기록 순서로) 놓이며
 * `showsParagraph`로 문단(`relations`)과 받는 쪽 링크(`backlinks`)로 나뉜다(DEC-54). 설정집 게시판의 연결 수·제목 옆 수도 이 결과의 목록 길이라 카드 페이지의 '관계'·'연결'과 늘 같다.
 */
function pageAt(world: PublicWorld, me: number): CardPage {
  const order = bookOrder(world)
  const kind = CARD_KIND[world.cards[me].cardType]
  const rank = new Map(order.map((index, k) => [index, k]))
  const positions = new Map(world.cards.map((card, index) => [card.id, index]))
  const touching = world.relationships.flatMap((relation) => {
    const a = positions.get(relation.sourceCardId), b = positions.get(relation.targetCardId)
    if (a === undefined || b === undefined || a === b || (a !== me && b !== me)) return []
    return [{ relation, other: a === me ? b : a, sends: a === me }]
  }).sort((x, y) => rank.get(x.other)! - rank.get(y.other)!)
  const ref = ({ relation: r, other }: (typeof touching)[number]) => ({ ...cardRef(world, other, relationName(r.category, r.label) || undefined), relationId: r.id, category: r.category, direction: r.direction ?? null, body: r.body, polarity: r.polarity, history: r.history })
  // 본문 링크로 이 카드를 가리킨 카드(관계로 이미 이어진 카드는 위 관계가 보인다)를 설정집 순서로
  const linkedBy = linkPairs(world, cardPairs(world)).filter(([, to]) => to === me).map(([from]) => from).sort((x, y) => rank.get(x)! - rank.get(y)!)
  const organizations = new Set<number>()
  const affiliated = kind === '인물' ? touching.filter(({ other }) => {
    if (world.cards[other].cardType !== 'organization' || organizations.has(other)) return false
    organizations.add(other)
    return true
  }) : []
  const at = order.indexOf(me)
  return {
    card: { ...cardRef(world, me), text: world.cards[me].text, aliases: world.cards[me].aliases, tags: world.cards[me].tags, ...(world.cards[me].imageId ? { imageId: world.cards[me].imageId } : {}) },
    affiliations: affiliated.map(ref),
    relations: touching.filter(({ relation, sends }) => showsParagraph(relation.direction, sends)).map(ref),
    backlinks: [...touching.filter(({ relation, sends }) => !showsParagraph(relation.direction, sends)).map(ref), ...linkedBy.map((i) => cardRef(world, i, '본문 링크'))],
    sameType: order.filter((i) => i !== me && CARD_KIND[world.cards[i].cardType] === kind).map((i) => cardRef(world, i)),
    prev: at > 0 ? cardRef(world, order[at - 1]) : undefined,
    next: at < order.length - 1 ? cardRef(world, order[at + 1]) : undefined,
  }
}

/** 카드 한 장의 페이지(`/worlds/:id/cards/:cardId`)가 보일 내용. 그 세계관에 없는 카드 id는 undefined다. */
export function cardPage(world: PublicWorld, cardId: string): CardPage | undefined {
  const me = world.cards.findIndex((c) => c.id === cardId)
  return me >= 0 ? pageAt(world, me) : undefined
}

/**
 * 설정집 게시판의 한 줄. `no`는 지금 보이는 목록(필터·정렬 뒤)의 순번(1부터), `connections`는 이어진 카드 수(인물 관계 + 설정 연관, 양쪽에서 쓴 것 포함)다.
 * `badge`는 제목 옆에 댓글 수처럼 붙는 수로, 인물은 인물 관계 수이고 그 밖은 연결 수다(카드 페이지 정보 표의 '관계'·'연결'과 같은 값).
 */
export type BookRow = BoardRow

/**
 * 공개 세계관의 카드를 설정집 순서의 게시판 원자료로 바꾼다. 연결 수·제목 옆 수는 카드 페이지(`pageAt`)의 목록 길이라 두 화면이 늘 같다.
 * 요약 열(`text`)은 한 줄로 보이므로 본문의 마크다운 기호를 벗긴 글자이고 검색도 그 글자에 맞춘다.
 */
function bookEntries(world: PublicWorld): BoardEntry[] {
  const connections = new Uint32Array(world.cards.length), people = new Uint32Array(world.cards.length)
  const pairs = cardPairs(world)
  for (const { a, b } of pairs) {
    connections[a]++; connections[b]++
    if (world.cards[a].cardType === 'character' && world.cards[b].cardType === 'character') { people[a]++; people[b]++ }
  }
  for (const [, to] of linkPairs(world, pairs)) connections[to]++ // 본문 링크: 가리킨 카드의 '이 설정을 가리키는 관계'라 그 카드에만 센다
  return bookOrder(world).map((i) => {
    const { id, title, text, cardType } = world.cards[i]
    const kind = CARD_KIND[cardType]
    return { cardId: id, title, text: plainCardText(text), type: typeLabel(cardType), kind, connections: connections[i], badge: kind === '인물' ? people[i] : connections[i] }
  })
}

/** 설정집 게시판의 줄들: 유형·검색어로 거른 카드를 정렬해 순번을 매긴다(필터·정렬 규칙은 shared의 `boardRows`). */
export const bookRows = (world: PublicWorld, filter: Parameters<typeof boardRows>[1] = {}): BookRow[] => boardRows(bookEntries(world), filter)

/** 카드가 있는 유형 묶음과 장수(인물·장소·조직·규칙·사건·기타 순). 설정집의 분류 메뉴와 그래프 범례가 함께 쓴다. */
export const kindCounts = (world: PublicWorld) => KINDS.map((kind) => ({ kind, count: world.cards.filter((card) => CARD_KIND[card.cardType] === kind).length })).filter(({ count }) => count > 0)
/** `?type=` 값. 그 세계관에 카드가 있는 유형 이름이면 그 유형이고, 없거나 모르는 값이면 undefined(전체)다. */
export const parseBookKind = (value: string | null, kinds: readonly CardKind[]) => kinds.find((k) => k === value)

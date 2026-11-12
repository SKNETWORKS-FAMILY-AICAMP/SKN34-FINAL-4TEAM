import type { PublicWorld } from '../../../domain/entities/publicWorld'
import { cardTypes, type CardType } from '../../../domain/entities/studioCards'
import { CARD_COLORS, CARD_KIND, KINDS, boardKindCounts, boardRows, type BoardEntry, type BoardRow, type CardKind } from '../../shared/worldBoard'
import { genreLabel } from '../../shared/worldGenres'
import { GENRE_COLORS } from './worldAtlas'

/*
 * 공개 세계관 상세(`/worlds/:id`)와 설정 카드 페이지(`/worlds/:id/cards/:cardId`)의 순수 규칙: 설정 그래프·인물관계도의 노드·링크,
 * 설정집 게시판(유형·검색어 필터, 정렬, 번호), 카드 한 장의 페이지(관계·연관·역방향 연관·같은 유형·이전/다음).
 *
 * 공개 세계관 상세 API(`GET /api/v1/public/world-studios/{id}`)의 카드와 현재 관계(양 끝 카드 id)를 그래프·카드 페이지로 바꾼다. 카드 페이지 주소의 cardId는 카드 id다.
 * 관계 중 인물↔인물은 인물관계도(라벨이 관계)가, 그 밖은 설정 연관이 된다. 관계 상태가 `unavailable`이면 서버가 관계를 비워 주므로 연결이 없는 그래프가 된다(화면이 따로 알린다).
 * ponytail: 연관은 방향이 없고 같은 두 카드 사이의 관계는 방향·종류와 상관없이 먼저 나온 하나만 보인다(그래프에서 같은 두 노드의 선이 겹쳐 라벨을 읽을 수 없다).
 * 쓴 쪽이 카드 페이지의 '연관'·반대쪽이 '가리키는 설정'이다. 여러 관계를 한 선에 묶어 보이는 것은 같은 두 카드의 관계가 실제로 여럿 쌓일 때 더한다.
 */

export const DETAIL_TABS = [['graph', '설정 그래프'], ['people', '인물관계도'], ['book', '설정집']] as const
export type DetailTab = (typeof DETAIL_TABS)[number][0]
/** `?tab=` 값. 없거나 모르는 값이면 첫 탭(설정 그래프)이다. */
export const parseDetailTab = (value: string | null): DetailTab => DETAIL_TABS.find(([key]) => key === value)?.[0] ?? 'graph'

/** 설정 카드 페이지 주소. `cardId`는 서버 카드 id다. */
export const cardPath = (worldId: string, cardId: string | number) => `/worlds/${worldId}/cards/${cardId}`
/** 설정집 탭 주소. `kind`를 주면 그 유형 칩이 골라진 채로 열린다(`?type=`). */
export const bookPath = (worldId: string, kind?: CardKind) => `/worlds/${worldId}?${new URLSearchParams({ tab: 'book', ...(kind ? { type: kind } : {}) })}`

type CardPair = { a: number; b: number; label?: string }
/**
 * 카드 위치 쌍으로 본 카드 연관. 양 끝 카드가 없는 관계·자기 참조는 버리고, 같은 두 카드를 잇는 중복은 방향과 상관없이 먼저 나온 하나만 남긴다.
 * `a`는 관계의 출발(source) 카드, `b`는 도착(target)이고 빈 라벨은 라벨 없음이다. 그래프 링크와 카드 페이지의 연관 목록이 모두 이 결과를 쓴다.
 */
export function cardPairs(world: PublicWorld): CardPair[] {
  const at = new Map(world.cards.map((c, i) => [c.id, i]))
  const seen = new Set<string>()
  const pairs: CardPair[] = []
  for (const { sourceCardId, targetCardId, label } of world.relationships) {
    const a = at.get(sourceCardId)
    const b = at.get(targetCardId)
    if (a === undefined || b === undefined || a === b) continue
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push({ a, b, label: label || undefined })
  }
  return pairs
}

type Pos = { x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number }
/** `kind`는 중심이면 '세계관', 카드면 유형 묶음(색·범례와 같은 이름)이다. `to`는 노드를 누르면 갈 주소(카드는 카드 페이지, 중심은 설정집 탭)다. */
export type DetailNode = Pos & { id: string; name: string; kind: '세계관' | CardKind; color: string; to: string }
/** `world`는 중심→카드의 옅은 선, `link`는 카드끼리의 연관이다(인물끼리는 `label`이 관계). `source`·`target`은 ForceGraph가 노드 객체로 바꾼다. */
export type DetailLink = { source: string | DetailNode; target: string | DetailNode; kind: 'world' | 'link'; label?: string }
export type DetailGraph = { nodes: DetailNode[]; links: DetailLink[] }

export const detailEndpoint = (end: string | DetailNode) => (typeof end === 'string' ? end : end.id)

const cardNode = (world: PublicWorld, i: number): DetailNode => {
  const { id, title, cardType } = world.cards[i]
  const kind = CARD_KIND[cardType]
  return { id: `card:${id}`, name: title, kind, color: CARD_COLORS[kind], to: cardPath(world.id, id) }
}
const pairLink = (world: PublicWorld, { a, b, label }: CardPair): DetailLink => ({ source: `card:${world.cards[a].id}`, target: `card:${world.cards[b].id}`, kind: 'link', label })

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

const typeLabel = (type: CardType) => cardTypes.find((t) => t.id === type)?.label ?? type

/** 다른 카드를 가리키는 값. `type`은 카드 자신의 유형 이름(능력·사물 …), `kind`는 묶음(색·범례·설정집 섹션)이고 `label`은 이어 준 연관의 라벨이다. */
export type CardRef = { cardId: string; title: string; type: string; kind: CardKind; label?: string }
const cardRef = (world: PublicWorld, i: number, label?: string): CardRef => {
  const { id, title, cardType } = world.cards[i]
  return { cardId: id, title, type: typeLabel(cardType), kind: CARD_KIND[cardType], ...(label ? { label } : {}) }
}

/** 설정집 순서: 유형 묶음(인물·장소·조직·규칙·사건·기타) 순, 같은 묶음 안에서는 카드 순서. 값은 `world.cards`의 위치다. */
const bookOrder = (world: PublicWorld) => KINDS.flatMap((kind) => world.cards.flatMap((c, i) => (CARD_KIND[c.cardType] === kind ? [i] : [])))

export type CardPage = {
  card: CardRef & { text: string }
  /** 인물의 소속: 어느 쪽이 썼든 이어진 조직 카드. 인물이 아니면 빈 목록이다. */
  affiliations: CardRef[]
  /** 인물 카드가 다른 인물과 맺은 관계(`label`이 관계). 인물이 아닌 카드는 빈 목록이다. */
  relations: CardRef[]
  /** 이 카드가 쓴 연관 중 인물 관계가 아닌 것 */
  links: CardRef[]
  /** 다른 카드가 이 카드를 가리켜 쓴 연관 중 인물 관계가 아닌 것 */
  backlinks: CardRef[]
  /** 같은 유형 묶음의 다른 카드 */
  sameType: CardRef[]
  /** 세계관 전체를 설정집 순서로 이은 앞·뒤 카드 */
  prev?: CardRef
  next?: CardRef
}

/**
 * `me`번 카드의 페이지 내용. 연관은 `cardPairs`를 쓰므로 없는 대상·자기 참조는 없고 같은 두 카드는 한 번만 나오며(먼저 쓴 쪽 라벨), 모든 목록은 설정집 순서다.
 * 인물 카드는 다른 인물과의 연관을 `relations`로 따로 모아 `links`·`backlinks`에는 인물 밖의 연관만 둔다(한 카드가 한 목록에만 나온다).
 * 설정집 게시판의 연결 수·제목 옆 수도 이 결과의 목록 길이라 카드 페이지의 '관계'·'연결'과 늘 같다.
 */
function pageAt(world: PublicWorld, me: number): CardPage {
  const order = bookOrder(world)
  const kind = CARD_KIND[world.cards[me].cardType]
  const person = kind === '인물'
  const inPerson = (i: number) => person && CARD_KIND[world.cards[i].cardType] === '인물'
  const touching = cardPairs(world)
    .flatMap(({ a, b, label }) => (a === me ? [{ i: b, label, out: true }] : b === me ? [{ i: a, label, out: false }] : []))
    .sort((x, y) => order.indexOf(x.i) - order.indexOf(y.i))
  const refs = (list: typeof touching) => list.map(({ i, label }) => cardRef(world, i, label))
  const at = order.indexOf(me)
  return {
    card: { ...cardRef(world, me), text: world.cards[me].text },
    affiliations: refs(touching.filter(({ i }) => person && world.cards[i].cardType === 'organization')),
    relations: refs(touching.filter(({ i }) => inPerson(i))),
    links: refs(touching.filter(({ i, out }) => out && !inPerson(i))),
    backlinks: refs(touching.filter(({ i, out }) => !out && !inPerson(i))),
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

/** 공개 세계관의 카드를 설정집 순서의 게시판 원자료로 바꾼다. 연결 수·제목 옆 수는 카드 페이지(`pageAt`)의 목록 길이라 두 화면이 늘 같다. */
function bookEntries(world: PublicWorld): BoardEntry[] {
  return bookOrder(world).map((i) => {
    const { id, title, text, cardType } = world.cards[i]
    const kind = CARD_KIND[cardType]
    const { relations, links, backlinks } = pageAt(world, i)
    const connections = relations.length + links.length + backlinks.length
    return { cardId: id, title, text, type: typeLabel(cardType), kind, connections, badge: kind === '인물' ? relations.length : connections }
  })
}

/** 설정집 게시판의 줄들: 유형·검색어로 거른 카드를 정렬해 순번을 매긴다(필터·정렬 규칙은 shared의 `boardRows`). */
export const bookRows = (world: PublicWorld, filter: Parameters<typeof boardRows>[1] = {}): BookRow[] => boardRows(bookEntries(world), filter)

/** 카드가 있는 유형 묶음과 장수(인물·장소·조직·규칙·사건·기타 순). 설정집의 분류 메뉴와 그래프 범례가 함께 쓴다. */
export const kindCounts = (world: PublicWorld) => boardKindCounts(bookEntries(world))
/** `?type=` 값. 그 세계관에 카드가 있는 유형 이름이면 그 유형이고, 없거나 모르는 값이면 undefined(전체)다. */
export const parseBookKind = (value: string | null, kinds: readonly CardKind[]) => kinds.find((k) => k === value)

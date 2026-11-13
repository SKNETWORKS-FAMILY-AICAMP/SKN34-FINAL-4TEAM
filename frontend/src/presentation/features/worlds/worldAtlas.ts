import { lineageOrigins, type PublicWorldSummary } from '../../../domain/entities/publicWorld'
import { CARD_COLORS, CARD_KIND } from '../../shared/worldBoard'
import { ALL_CHIP, genreLabel, type GenreLabel } from '../../shared/worldGenres'

/*
 * 세계관 지도(`/worlds` 상단 노드 그래프)의 순수 규칙: 공개 세계관 목록 → 노드·링크, 실시간 인기 순위, 장르 칩 하이라이트.
 *
 * 서버 목록(`PublicWorldSummary`)은 장르·카드 수만 주므로 실제 모드의 지도는 장르→세계관(크기는 카드 수)뿐이다. 카드 점(`cards`)과
 * 파생·조합 선(`derivedFrom`·`combinedFrom`)은 메모리 데모만 채우는 선택 필드라 있을 때만 그린다(계약 범위 밖, DEC-35).
 * ponytail: 하이라이트는 장르 칩 하나에 대해 한 단계 이웃까지만 밝힌다(여러 단계를 따라가면 이어진 망 전체가 밝아져 뜻이 없어진다).
 */

/** 파생·조합 선 색. 노드 색(장르·카드 유형)과 겹치지 않는 밝은 앰버·아쿠아이고 범례와 캔버스가 함께 쓴다(범례가 캔버스 파일을 import하면 지연 로딩이 깨진다). */
export const LINEAGE_COLORS = { derive: '#FFC857', combine: '#7FE7D9' } as const
/** 장르 노드·세계관 노드의 색. 어두운 캔버스 위에서 읽히는 밝은 색이다. */
export const GENRE_COLORS: Record<GenreLabel, string> = {
  판타지: '#B79CFF', SF: '#4CC9F0', 무협: '#FF6B6B', 로맨스: '#FF8FC8', 현대: '#4ADE80', 고전: '#E8C99B', 미스터리: '#94A3C8', 미지정: '#9AA7BD',
}
/** 세계관이 파생·조합으로 쓰인 횟수 하나를 설정 카드 몇 장만큼으로 칠지(노드 크기 가중) */
export const WORLD_USE_WEIGHT = 2

type AtlasNodeBase = { id: string; name: string; genre: GenreLabel; color: string; val: number; x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number }
/** `name`은 장르명·세계관 이름·카드 제목이다. 세계관 노드의 `worldId`가 상세 주소(`/worlds/:id`)가, 카드 노드의 `worldId`·`cardId`(카드 id)가 카드 페이지 주소가 된다. */
export type AtlasNode = AtlasNodeBase & ({ kind: 'genre' } | { kind: 'world'; worldId: string } | { kind: 'card'; worldId: string; cardId: string })
/** `derive`는 원본→파생, `combine`은 조합의 원본마다 원본→조합 방향이다. `source`·`target`은 ForceGraph가 노드 객체로 바꾼다. */
export type AtlasLink = { source: string | AtlasNode; target: string | AtlasNode; kind: 'genre' | 'card' | 'derive' | 'combine' }
export type WorldAtlas = { nodes: AtlasNode[]; links: AtlasLink[]; stats: { worlds: number; cards: number; derived: number; combined: number } }

export const atlasEndpoint = (end: string | AtlasNode) => (typeof end === 'string' ? end : end.id)
/** 장르는 크게 고정, 카드는 작은 점, 세계관은 `val`(카드 수 + 쓰인 횟수 가중)의 제곱근에 비례한다. */
export const nodeRadius = (n: AtlasNode) => (n.kind === 'genre' ? 16 : n.kind === 'card' ? 2.6 : 4 + 2.2 * Math.sqrt(n.val))
/**
 * 캔버스에 이름을 그릴 노드. 늘 그리는 것은 장르뿐이고 세계관·카드는 마우스를 올린 노드 하나만 그린다.
 * 노드가 많아져도 글자가 겹치지 않게 확대 정도와는 연동하지 않는다. 이름 탐색은 접근성 요약·실시간 인기 순위·아래 목록이 맡는다.
 */
export const showsLabel = (node: AtlasNode, hovered?: string) => node.kind === 'genre' || node.id === hovered

/** 세계관 id → 그 세계관이 파생·조합의 원본으로 쓰인 횟수(안 쓰였으면 0) */
export function lineageCounts(worlds: readonly PublicWorldSummary[]) {
  const known = new Set(worlds.map((w) => w.id))
  const counts = new Map(worlds.map((w) => [w.id, 0]))
  for (const w of worlds) for (const o of lineageOrigins(w, known)) counts.set(o.id, (counts.get(o.id) ?? 0) + 1)
  return counts
}

/**
 * 파생·조합으로 쓰인 횟수가 많은 순(같으면 설정 카드가 많은 순, 그래도 같으면 배열 순서) 상위 `limit`개.
 * 파생·조합이 있는 데모의 '실시간 인기' 순위 기준이다. 입력 배열은 바꾸지 않는다.
 */
export function rankByLineage(worlds: readonly PublicWorldSummary[], limit = 10) {
  const used = lineageCounts(worlds)
  return worlds.toSorted((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || b.cardCount - a.cardCount).slice(0, limit)
}

/** 공개 시각이 최근인 순(같은 순간이면 입력 순서) 상위 `limit`개. 서버 목록에는 조회수·계보가 없어 '실시간 인기' 순위의 기준이다. 입력 배열은 바꾸지 않는다. */
export function rankByRecent(worlds: readonly PublicWorldSummary[], limit = 10) {
  return worlds.toSorted((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, limit)
}

/** 지도 옆 '실시간 인기' 순위와 그 기준. 쓸 수 있는 파생·조합이 하나라도 있으면(데모) 쓰인 횟수 순, 없으면(서버 목록) 최근 공개 순이다. */
export function liveRank(worlds: readonly PublicWorldSummary[], limit = 10): { basis: 'lineage' | 'recent'; worlds: PublicWorldSummary[] } {
  const lineage = [...lineageCounts(worlds).values()].some((n) => n > 0)
  return lineage ? { basis: 'lineage', worlds: rankByLineage(worlds, limit) } : { basis: 'recent', worlds: rankByRecent(worlds, limit) }
}

const genreNodeId = (genre: string) => `genre:${genre}`
const worldNodeId = (id: string) => `world:${id}`
const cardNodeId = (id: string, cardId: string) => `card:${id}:${cardId}`

/**
 * 호출마다 새 객체를 만든다. ForceGraph가 노드에 좌표를 붙이고 링크 끝점을 노드 객체로 바꾸기 때문이다.
 * 노드는 카드 → 세계관 → 장르 순이다. 뒤에 올수록 위에 그려지고 클릭도 먼저 받아, 큰 노드와 그 이름이 작은 카드 점에 가려지지 않는다.
 */
export function buildWorldAtlas(worlds: readonly PublicWorldSummary[]): WorldAtlas {
  const known = new Set(worlds.map((w) => w.id))
  const used = lineageCounts(worlds)
  const cardNodes: AtlasNode[] = []
  const worldNodes: AtlasNode[] = []
  const links: AtlasLink[] = []
  let derived = 0, combined = 0
  for (const w of worlds) {
    const genre = genreLabel(w.genre)
    worldNodes.push({ kind: 'world', id: worldNodeId(w.id), name: w.name, genre, worldId: w.id, color: GENRE_COLORS[genre], val: w.cardCount + WORLD_USE_WEIGHT * (used.get(w.id) ?? 0) })
    links.push({ source: genreNodeId(genre), target: worldNodeId(w.id), kind: 'genre' })
    for (const c of w.cards ?? []) {
      cardNodes.push({ kind: 'card', id: cardNodeId(w.id, c.id), name: c.title, genre, worldId: w.id, cardId: c.id, color: CARD_COLORS[CARD_KIND[c.cardType]], val: 1 })
      links.push({ source: worldNodeId(w.id), target: cardNodeId(w.id, c.id), kind: 'card' })
    }
    const origins = lineageOrigins(w, known)
    for (const o of origins) links.push({ source: worldNodeId(o.id), target: worldNodeId(w.id), kind: o.kind })
    if (origins.some((o) => o.kind === 'derive')) derived++
    if (origins.some((o) => o.kind === 'combine')) combined++
  }
  const genreNodes = [...new Set(worlds.map((w) => genreLabel(w.genre)))].map((genre): AtlasNode => ({ kind: 'genre', id: genreNodeId(genre), name: genre, genre, color: GENRE_COLORS[genre], val: 1 }))
  return { nodes: [...cardNodes, ...worldNodes, ...genreNodes], links, stats: { worlds: worlds.length, cards: worlds.reduce((n, w) => n + w.cardCount, 0), derived, combined } }
}

/** 지도 아래 통계·범례가 보일 것: 카드 점이 있으면(설정 카드 유형 색 범례), 파생·조합이 있으면(연결 선 범례·파생·조합 통계). 서버 목록 지도는 둘 다 없다. */
export const atlasFeatures = ({ nodes, stats }: Pick<WorldAtlas, 'nodes' | 'stats'>) => ({ cards: nodes.some((n) => n.kind === 'card'), lineage: stats.derived + stats.combined > 0 })

/** 이름을 캔버스에 직접 그릴 때 쓰는 글꼴. 세계관 지도와 상세의 두 그래프가 함께 쓴다. */
export const CANVAS_FONT = '"Pretendard Variable", Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'

const GRAVITY = 0.08
/**
 * 캔버스 가로세로비에 맞춰 노드를 중심으로 당기는 약한 중력(d3 force). 가로로 긴 화면은 세로를, 세로로 긴 화면은 가로를 더 당겨
 * 지도가 캔버스를 고르게 채운다(모바일에서도 맞춤 배율이 작아지지 않는다). 비율은 3:1까지만 따르고, 못 쟀으면 데스크톱 비율(1.9)을 쓴다.
 * 수치는 데모 데이터로 d3-force를 돌려 데스크톱·태블릿·모바일 캔버스를 가로 80~90%·세로 83~86% 채우게 고른 값이다.
 * 세계관 상세의 두 그래프도 같은 힘을 쓰므로 노드 타입은 좌표만 있으면 되고(기본은 지도 노드) 노드가 훨씬 적은 그래프는 더 센 `gravity`를 넘긴다.
 */
export function aspectGravity<N extends { x?: number; y?: number; vx?: number; vy?: number } = AtlasNode>(aspect: () => number, gravity = GRAVITY) {
  let nodes: N[] = []
  const force = (alpha: number) => {
    const ratio = Math.min(3, Math.max(1 / 3, aspect() || 1.9)) ** 0.65
    for (const n of nodes) {
      n.vx = (n.vx ?? 0) - (n.x ?? 0) * (gravity / ratio) * alpha
      n.vy = (n.vy ?? 0) - (n.y ?? 0) * (gravity * ratio) * alpha
    }
  }
  force.initialize = (all: N[]) => { nodes = all }
  return force
}

/**
 * 장르 칩이 골라진 동안 밝게 둘 노드 id. 그 장르의 장르·세계관·카드 노드와, 그 세계관에 파생·조합으로 바로 이어진 다른 세계관 노드다.
 * 추천 칩이면 흐리게 할 것이 없어 undefined, 그 장르의 세계관이 없으면 빈 집합이다.
 */
export function highlightIds(atlas: Pick<WorldAtlas, 'nodes' | 'links'>, chip: string): ReadonlySet<string> | undefined {
  if (chip === ALL_CHIP) return undefined
  const lit = new Set<string>()
  const worldsInGenre = new Set<string>()
  for (const n of atlas.nodes) {
    if (n.genre !== chip) continue
    lit.add(n.id)
    if (n.kind === 'world') worldsInGenre.add(n.id)
  }
  for (const l of atlas.links) {
    if (l.kind !== 'derive' && l.kind !== 'combine') continue
    const [from, to] = [atlasEndpoint(l.source), atlasEndpoint(l.target)]
    if (worldsInGenre.has(from)) lit.add(to)
    if (worldsInGenre.has(to)) lit.add(from)
  }
  return lit
}

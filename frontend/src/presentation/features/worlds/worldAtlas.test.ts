import { describe, expect, it } from 'vitest'

import { InMemoryPublicWorldRepository } from '../../../data/mock/InMemoryPublicWorldRepository'
import type { PublicWorldSummary } from '../../../domain/entities/publicWorld'
import { CARD_COLORS } from '../../shared/worldBoard'
import { ALL_CHIP, UNSET_GENRE, WORLD_GENRES, genreCode, type WorldGenre } from '../../shared/worldGenres'
import {
  GENRE_COLORS, LINEAGE_COLORS, WORLD_USE_WEIGHT, aspectGravity, atlasEndpoint, atlasFeatures, buildWorldAtlas, highlightIds, lineageCounts, liveRank, nodeRadius, rankByLineage, rankByRecent, showsLabel,
  type AtlasLink, type AtlasNode, type WorldAtlas,
} from './worldAtlas'

/** 카드 점이 있는 세계관 요약(설정 카드 2장). 카드 id는 위치, 지도 점은 이 카드로 그려진다(목록 응답에는 없고 메모리 데모만 준다). */
const world = (id: string, genre: WorldGenre, lineage: Pick<PublicWorldSummary, 'derivedFrom' | 'combinedFrom'> = {}): PublicWorldSummary => ({
  id, name: `${id} 세계`, description: '설명', genre: genreCode(genre) ?? null, authorNickname: '작가', cardCount: 2, relationshipCount: 0, publishedAt: '2026-11-01T00:00:00Z',
  cards: [{ id: '0', title: `${id} 카드 1`, cardType: 'other' }, { id: '1', title: `${id} 카드 2`, cardType: 'character' }], ...lineage,
})
/** 서버 목록 응답처럼 카드 점·계보가 없는 세계관 요약 */
const listed = (id: string, genre: PublicWorldSummary['genre'], extra: Partial<PublicWorldSummary> = {}): PublicWorldSummary => ({
  id, name: `${id} 세계`, description: '설명', genre, authorNickname: '작가', cardCount: 3, relationshipCount: 1, publishedAt: '2026-11-01T00:00:00Z', ...extra,
})
// 메모리 데모의 세계관 요약 26개(파생·조합과 카드 점이 모두 있다)
const DEMO = (await new InMemoryPublicWorldRepository().list({ page: 0, size: 100 })).items

// a ← b(파생) ← c(재파생), d = a + c(조합), e는 어디에도 이어지지 않는다
const sample = [
  world('a', '판타지'),
  world('b', 'SF', { derivedFrom: 'a' }),
  world('c', '무협', { derivedFrom: 'b' }),
  world('d', '로맨스', { combinedFrom: ['a', 'c'] }),
  world('e', '현대'),
]
// 없는 원본·자기 자신·조합 안의 중복 원본
const broken = [
  world('a', '판타지'),
  world('x', 'SF', { derivedFrom: 'ghost' }),
  world('y', 'SF', { derivedFrom: 'y' }),
  world('z', 'SF', { combinedFrom: ['z', 'ghost', 'a', 'a'] }),
]

/** 노드를 읽기 쉬운 이름으로: 장르는 장르명, 세계관은 id, 카드는 `세계관id:카드제목` */
const tag = (n: AtlasNode) => (n.kind === 'genre' ? n.genre : n.kind === 'world' ? n.worldId : `${n.worldId}:${n.name}`)
const find = (atlas: WorldAtlas, kind: AtlasNode['kind'], key: string) => atlas.nodes.find((n) => n.kind === kind && tag(n) === key)!
const pairs = (atlas: WorldAtlas, kind: AtlasLink['kind']) => {
  const byId = new Map(atlas.nodes.map((n) => [n.id, n]))
  return atlas.links.filter((l) => l.kind === kind).map((l) => [tag(byId.get(atlasEndpoint(l.source))!), tag(byId.get(atlasEndpoint(l.target))!)])
}

describe('lineageCounts', () => {
  it('파생과 조합으로 원본이 쓰인 횟수를 세고 쓰이지 않은 세계관은 0이다', () => {
    expect(Object.fromEntries(lineageCounts(sample))).toEqual({ a: 2, b: 1, c: 1, d: 0, e: 0 })
  })

  it('없는 원본 id·자기 자신·조합 안의 중복 원본은 세지 않는다', () => {
    expect(Object.fromEntries(lineageCounts(broken))).toEqual({ a: 1, x: 0, y: 0, z: 0 })
  })
})

describe('buildWorldAtlas', () => {
  it('세계관이 있는 장르·세계관·설정 카드가 각각 노드가 되고 id가 겹치지 않는다', () => {
    const atlas = buildWorldAtlas(sample)
    const of = (kind: AtlasNode['kind']) => atlas.nodes.filter((n) => n.kind === kind)
    expect(of('genre').map(tag)).toEqual(['판타지', 'SF', '무협', '로맨스', '현대'])
    expect(of('world').map(tag)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(of('card')).toHaveLength(10)
    expect(new Set(atlas.nodes.map((n) => n.id)).size).toBe(atlas.nodes.length)
  })

  it('노드는 카드 → 세계관 → 장르 순이라 큰 노드와 그 이름이 작은 점 위에 그려지고 먼저 클릭된다', () => {
    const kinds = buildWorldAtlas(sample).nodes.map((n) => n.kind)
    expect(kinds.lastIndexOf('card')).toBeLessThan(kinds.indexOf('world'))
    expect(kinds.lastIndexOf('world')).toBeLessThan(kinds.indexOf('genre'))
  })

  it('카드 노드는 세계관 id와 그 카드의 위치(cardId)를 가져 카드 페이지로 갈 수 있다', () => {
    const cards = buildWorldAtlas([world('a', '판타지'), world('b', 'SF')]).nodes.flatMap((n) => (n.kind === 'card' ? [[n.worldId, n.cardId]] : []))
    expect(cards).toEqual([['a', '0'], ['a', '1'], ['b', '0'], ['b', '1']])
  })

  it('장르→세계관, 세계관→카드 링크를 하나씩 만든다', () => {
    const atlas = buildWorldAtlas([world('a', '판타지'), world('b', '판타지')])
    expect(pairs(atlas, 'genre')).toEqual([['판타지', 'a'], ['판타지', 'b']])
    expect(pairs(atlas, 'card').map(([from]) => from)).toEqual(['a', 'a', 'b', 'b'])
    expect(pairs(atlas, 'card')[0]).toEqual(['a', 'a:a 카드 1'])
  })

  it('파생은 원본→파생 링크 하나, 조합은 원본마다 원본→조합 링크 하나를 만든다', () => {
    const atlas = buildWorldAtlas(sample)
    expect(pairs(atlas, 'derive')).toEqual([['a', 'b'], ['b', 'c']])
    expect(pairs(atlas, 'combine')).toEqual([['a', 'd'], ['c', 'd']])
  })

  it('없는 원본 id와 자기 자신 참조는 링크를 만들지 않고 조합 안의 중복 원본은 한 번만 잇는다', () => {
    const atlas = buildWorldAtlas(broken)
    expect(pairs(atlas, 'derive')).toEqual([])
    expect(pairs(atlas, 'combine')).toEqual([['a', 'z']])
    expect(atlas.stats).toMatchObject({ derived: 0, combined: 1 })
  })

  it('통계는 세계관·카드 수와 파생·조합된 세계관 수다', () => {
    expect(buildWorldAtlas(sample).stats).toEqual({ worlds: 5, cards: 10, derived: 2, combined: 1 })
  })

  it('세계관 크기는 설정 카드 수에 파생·조합으로 쓰인 횟수 가중을 더한 값이다', () => {
    const atlas = buildWorldAtlas(sample)
    expect(find(atlas, 'world', 'a').val).toBe(2 + WORLD_USE_WEIGHT * 2)
    expect(find(atlas, 'world', 'e').val).toBe(2)
  })

  it('장르·세계관은 장르 색, 설정 카드는 유형 묶음 색이다', () => {
    const atlas = buildWorldAtlas([world('a', 'SF')])
    expect(atlas.nodes.filter((n) => n.kind !== 'card').map((n) => n.color)).toEqual([GENRE_COLORS.SF, GENRE_COLORS.SF])
    expect(atlas.nodes.filter((n) => n.kind === 'card').map((n) => n.color)).toEqual([CARD_COLORS.기타, CARD_COLORS.인물])
  })

  it('부를 때마다 새 객체를 돌려줘 ForceGraph가 노드·링크를 바꿔도 다음 지도가 오염되지 않는다', () => {
    const first = buildWorldAtlas(sample)
    first.links[0].source = first.nodes[3] // ForceGraph가 끝점을 노드 객체로 바꾸고 좌표를 붙이는 것을 흉내
    first.nodes[0].x = 99
    const second = buildWorldAtlas(sample)
    expect(second).toEqual(buildWorldAtlas(sample))
    expect(typeof second.links[0].source).toBe('string')
    expect(second.nodes[0].x).toBeUndefined()
  })

  it('데모 세계관으로 만든 지도는 모든 링크 끝점이 실제 노드이고 파생·조합이 모두 있다', () => {
    const atlas = buildWorldAtlas(DEMO)
    const ids = new Set(atlas.nodes.map((n) => n.id))
    for (const l of atlas.links) expect([ids.has(atlasEndpoint(l.source)), ids.has(atlasEndpoint(l.target))], l.kind).toEqual([true, true])
    expect(atlas.stats.worlds).toBe(DEMO.length)
    expect(atlas.stats.derived).toBeGreaterThan(0)
    expect(atlas.stats.combined).toBeGreaterThan(0)
  })
})

describe('색', () => {
  it('모든 장르·카드 유형 묶음·파생/조합 선에 #RRGGBB 색이 있다', () => {
    for (const genre of [...WORLD_GENRES, UNSET_GENRE]) expect(GENRE_COLORS[genre], genre).toMatch(/^#[0-9a-f]{6}$/i)
    for (const [kind, color] of Object.entries({ ...CARD_COLORS, ...LINEAGE_COLORS })) expect(color, kind).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('nodeRadius', () => {
  it('설정 카드 < 세계관 < 장르 순으로 크고 세계관은 쓰인 횟수가 많을수록 커진다', () => {
    const atlas = buildWorldAtlas(DEMO)
    const radii = (kind: AtlasNode['kind']) => atlas.nodes.filter((n) => n.kind === kind).map(nodeRadius)
    expect(Math.max(...radii('card'))).toBeLessThan(Math.min(...radii('world')))
    expect(Math.max(...radii('world'))).toBeLessThan(Math.min(...radii('genre')))
    const small = buildWorldAtlas(sample)
    expect(nodeRadius(find(small, 'world', 'a'))).toBeGreaterThan(nodeRadius(find(small, 'world', 'e')))
  })
})

describe('aspectGravity', () => {
  /** 두 노드가 같은 거리만큼 떨어진 곳에 있을 때 한 틱의 속도 변화 */
  const pull = (aspect: number) => {
    const node: AtlasNode = { ...buildWorldAtlas([world('a', '판타지')]).nodes[0], x: 100, y: 100, vx: 0, vy: 0 }
    const force = aspectGravity(() => aspect)
    force.initialize([node])
    force(1)
    return { vx: node.vx!, vy: node.vy! }
  }

  it('가로로 긴 캔버스는 세로 방향을, 세로로 긴 캔버스는 가로 방향을 더 세게 중심으로 당긴다', () => {
    const wide = pull(2)
    expect(wide.vx).toBeLessThan(0)
    expect(Math.abs(wide.vy)).toBeGreaterThan(Math.abs(wide.vx))
    const tall = pull(0.8)
    expect(Math.abs(tall.vx)).toBeGreaterThan(Math.abs(tall.vy))
  })

  it('정사각형이면 두 방향이 같고 아직 크기를 못 쟀거나 극단적인 비율이면 안전한 비율로 바꿔 쓴다', () => {
    const square = pull(1)
    expect(square.vx).toBeCloseTo(square.vy)
    for (const aspect of [0, NaN, 1000]) {
      const { vx, vy } = pull(aspect)
      expect([Number.isFinite(vx), Number.isFinite(vy)]).toEqual([true, true])
    }
    expect(pull(1000)).toEqual(pull(3)) // 비율은 3:1까지만 따른다
  })
})

describe('showsLabel', () => {
  const atlas = buildWorldAtlas(sample)
  const genres = ['판타지', 'SF', '무협', '로맨스', '현대']
  const named = (hovered?: string) => atlas.nodes.filter((n) => showsLabel(n, hovered)).map(tag)

  it('이름을 늘 그리는 노드는 장르뿐이다', () => {
    expect(named()).toEqual(genres)
    expect(named('없는-id')).toEqual(genres)
  })

  it('세계관·카드 이름은 마우스를 올린 노드 하나만 그린다', () => {
    expect(named(find(atlas, 'world', 'b').id)).toEqual(['b', ...genres])
    expect(named(find(atlas, 'card', 'b:b 카드 1').id)).toEqual(['b:b 카드 1', ...genres])
  })
})

describe('highlightIds', () => {
  const atlas = buildWorldAtlas(sample)
  const lit = (chip: string, from = atlas) => [...(highlightIds(from, chip) ?? [])].map((id) => tag(from.nodes.find((n) => n.id === id)!)).sort()

  it('추천 칩은 흐리게 할 것이 없어 undefined다', () => {
    expect(highlightIds(atlas, ALL_CHIP)).toBeUndefined()
  })

  it('장르 칩은 그 장르 노드·세계관·카드와 파생·조합으로 바로 이어진 세계관만 밝힌다', () => {
    // 판타지 a: 파생된 b와 조합된 d만 더해지고, 재파생 c·그 카드·다른 장르는 흐리다
    expect(lit('판타지')).toEqual(['a', 'a:a 카드 1', 'a:a 카드 2', 'b', 'd', '판타지'])
  })

  it('원본 쪽으로 이어진 세계관도 밝힌다', () => {
    // 무협 c: 원본 b와 c로 조합된 d
    expect(lit('무협')).toEqual(['b', 'c', 'c:c 카드 1', 'c:c 카드 2', 'd', '무협'])
  })

  it('그 장르의 세계관이 없으면 밝힐 노드가 없다', () => {
    expect(lit('고전')).toEqual([])
  })

  it('ForceGraph가 링크 끝점을 노드 객체로 바꾼 뒤에도 같은 결과를 준다', () => {
    const mutated = buildWorldAtlas(sample)
    const byId = new Map(mutated.nodes.map((n) => [n.id, n]))
    for (const l of mutated.links) {
      l.source = byId.get(atlasEndpoint(l.source))!
      l.target = byId.get(atlasEndpoint(l.target))!
    }
    expect(lit('판타지', mutated)).toEqual(lit('판타지'))
  })
})

describe('rankByLineage', () => {
  const ids = (worlds: PublicWorldSummary[], limit?: number) => rankByLineage(worlds, limit).map((w) => w.id)
  const cards = (id: string, n: number, lineage = {}) => ({ ...world(id, '판타지', lineage), cardCount: n })

  it('파생·조합으로 쓰인 횟수가 많은 순이고 쓰인 적 없는 세계관이 뒤따른다', () => {
    expect(ids(sample)).toEqual(['a', 'b', 'c', 'd', 'e']) // a 2회, b·c 1회(같은 카드 수 → 배열 순서), d·e 0회
  })

  it('횟수가 같으면 설정 카드가 많은 순, 그래도 같으면 배열 순서다', () => {
    const worlds = [cards('x', 3), cards('y', 5), cards('z', 5), cards('use', 2, { derivedFrom: 'x' })]
    expect(ids(worlds)).toEqual(['x', 'y', 'z', 'use']) // x가 1회로 앞, 0회끼리는 y·z(카드 5, 배열 순서) → use(카드 2)
  })

  it('없는 원본·자기 자신 참조는 횟수에 치지 않는다', () => {
    expect(ids(broken)[0]).toBe('a') // a만 z의 조합 원본으로 1회, 나머지는 0회
    expect(ids([cards('p', 3), cards('q', 6, { derivedFrom: 'q' })])).toEqual(['q', 'p']) // 둘 다 0회라 카드 수 순
  })

  it('상위 limit개만 돌려주고(기본 10) 입력 순서는 바꾸지 않는다', () => {
    const before = DEMO.map((w) => w.id)
    expect(rankByLineage(DEMO)).toHaveLength(10)
    expect(ids(sample, 2)).toEqual(['a', 'b'])
    expect(ids(sample, 99)).toHaveLength(sample.length)
    expect(DEMO.map((w) => w.id)).toEqual(before)
  })

  it('데모 세계관의 1위는 가장 많이 쓰인 세계관이고 횟수는 내려가기만 한다', () => {
    const used = lineageCounts(DEMO)
    const counts = rankByLineage(DEMO).map((w) => used.get(w.id)!)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(counts[0]).toBe(Math.max(...used.values()))
  })
})

describe('rankByRecent', () => {
  const at = (id: string, publishedAt: string) => listed(id, 'fantasy', { publishedAt })
  const ids = (worlds: PublicWorldSummary[], limit?: number) => rankByRecent(worlds, limit).map((w) => w.id)

  it('공개 시각이 최근인 순이고 같은 시각이면 입력 순서를 지킨다', () => {
    const worlds = [at('old', '2026-11-01T00:00:00Z'), at('new', '2026-11-12T00:00:00Z'), at('mid-a', '2026-11-05T00:00:00Z'), at('mid-b', '2026-11-05T00:00:00Z')]
    expect(ids(worlds)).toEqual(['new', 'mid-a', 'mid-b', 'old'])
  })

  it('시간대 표기가 달라도 같은 순간을 기준으로 견준다', () => {
    // 10:00+09:00은 01:00Z라 00:30Z보다 나중이다(글자 순서로는 앞서 보인다)
    expect(ids([at('utc', '2026-11-11T00:30:00Z'), at('seoul', '2026-11-11T10:00:00+09:00')])).toEqual(['seoul', 'utc'])
  })

  it('상위 limit개만 돌려주고(기본 10) 입력 순서는 바꾸지 않는다', () => {
    const worlds = Array.from({ length: 12 }, (_, n) => at(`w${n}`, `2026-11-${String(n + 1).padStart(2, '0')}T00:00:00Z`))
    const before = worlds.map((w) => w.id)
    expect(rankByRecent(worlds)).toHaveLength(10)
    expect(ids(worlds, 2)).toEqual(['w11', 'w10'])
    expect(worlds.map((w) => w.id)).toEqual(before)
  })
})

describe('liveRank', () => {
  it('파생·조합이 있는 데이터(데모)는 쓰인 횟수 순이다', () => {
    const { basis, worlds } = liveRank(sample)
    expect(basis).toBe('lineage')
    expect(worlds.map((w) => w.id)).toEqual(rankByLineage(sample).map((w) => w.id))
  })

  it('서버 목록처럼 계보가 없으면 최근 공개 순이다', () => {
    const { basis, worlds } = liveRank([listed('old', 'sf', { publishedAt: '2026-11-01T00:00:00Z' }), listed('new', 'sf', { publishedAt: '2026-11-09T00:00:00Z' })])
    expect(basis).toBe('recent')
    expect(worlds.map((w) => w.id)).toEqual(['new', 'old'])
  })

  it('계보 필드가 있어도 쓸 수 있는 원본이 하나도 없으면(없는 id·자기 자신) 계보가 없는 데이터로 본다', () => {
    const { basis } = liveRank([listed('x', 'sf', { derivedFrom: 'ghost' }), listed('y', 'sf', { derivedFrom: 'y' })])
    expect(basis).toBe('recent')
  })
})

describe('서버 목록으로 만든 지도(카드 점·계보 없음)', () => {
  const real = [listed('a', 'fantasy', { cardCount: 5 }), listed('b', 'fantasy', { cardCount: 0 }), listed('c', null, { cardCount: 2 }), listed('d', 'sf')]

  it('장르와 세계관만 노드가 되고 카드 점·파생·조합 링크는 없다', () => {
    const atlas = buildWorldAtlas(real)
    expect(atlas.nodes.map((n) => [n.kind, tag(n)])).toEqual([
      ['world', 'a'], ['world', 'b'], ['world', 'c'], ['world', 'd'], ['genre', '판타지'], ['genre', '미지정'], ['genre', 'SF'],
    ])
    expect(new Set(atlas.links.map((l) => l.kind))).toEqual(new Set(['genre']))
    expect(pairs(atlas, 'genre')).toEqual([['판타지', 'a'], ['판타지', 'b'], ['미지정', 'c'], ['SF', 'd']])
  })

  it('세계관 크기는 서버가 알려 준 설정 카드 수만으로 정해진다(쓰인 횟수 가중이 없다)', () => {
    const atlas = buildWorldAtlas(real)
    expect([find(atlas, 'world', 'a').val, find(atlas, 'world', 'b').val]).toEqual([5, 0])
    expect(nodeRadius(find(atlas, 'world', 'a'))).toBeGreaterThan(nodeRadius(find(atlas, 'world', 'b')))
  })

  it('통계는 세계관 수와 카드 수 합계이고 파생·조합은 0이다', () => {
    expect(buildWorldAtlas(real).stats).toEqual({ worlds: 4, cards: 5 + 0 + 2 + 3, derived: 0, combined: 0 })
  })

  it('장르가 없는 세계관은 미지정 장르 노드에 이어지고 그 색을 쓴다', () => {
    const atlas = buildWorldAtlas(real)
    expect(find(atlas, 'world', 'c').genre).toBe('미지정')
    expect(find(atlas, 'genre', '미지정').color).toBe(GENRE_COLORS.미지정)
  })
})

describe('atlasFeatures', () => {
  it('카드 점이 있으면 설정 카드 유형 범례를, 파생·조합이 있으면 연결 선 범례와 파생·조합 통계를 보인다', () => {
    expect(atlasFeatures(buildWorldAtlas(DEMO))).toEqual({ cards: true, lineage: true })
    expect(atlasFeatures(buildWorldAtlas([world('a', '판타지'), world('b', 'SF')]))).toEqual({ cards: true, lineage: false })
  })

  it('서버 목록 지도는 둘 다 숨긴다', () => {
    expect(atlasFeatures(buildWorldAtlas([listed('a', 'fantasy')]))).toEqual({ cards: false, lineage: false })
  })
})

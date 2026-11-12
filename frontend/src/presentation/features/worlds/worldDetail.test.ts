import { describe, expect, it } from 'vitest'

import { DEMO_WORLDS } from '../../../data/mock/demoPublicWorlds'
import { InMemoryPublicWorldRepository } from '../../../data/mock/InMemoryPublicWorldRepository'
import type { PublicWorld } from '../../../domain/entities/publicWorld'
import type { CardType } from '../../../domain/entities/studioCards'
import { BOOK_SORTS, CARD_COLORS } from '../../shared/worldBoard'
import { GENRE_COLORS } from './worldAtlas'
import {
  LABEL_ALL_MAX, bookPath, bookRows, buildCharacterGraph, buildSettingGraph, cardPage, cardPairs, cardPath, detailEndpoint, kindCounts, parseBookKind, parseDetailTab,
  showsDetailLabel, type CardRef, type DetailGraph, type DetailNode,
} from './worldDetail'

/** 카드 한 장의 명세. `links`는 제목으로 이은 연관(대상 제목, 인물끼리는 라벨이 관계)이고 `world()`가 서버와 같은 관계 목록으로 바꾼다. */
type Card = { type: CardType; title: string; links?: readonly { to: string; label?: string }[] }
const card = (title: string, type: CardType, links?: Card['links']): Card => ({ type, title, ...(links ? { links } : {}) })
/** 카드 위치(0부터)를 카드 id로 삼고 연관을 관계(양 끝 카드 id) 목록으로 바꾼 공개 세계관. 없는 대상 제목은 없는 카드 id가 된다. */
const world = (cards: Card[]): PublicWorld => {
  const idOf = new Map(cards.map((c, i) => [c.title, String(i)]))
  return {
    id: 'w', name: '시험 세계', description: '시험 세계의 개요', genre: 'fantasy', authorNickname: '작가', publishedAt: '2026-11-01T00:00:00Z', revisionNo: 1,
    cards: cards.map((c, i) => ({ id: String(i), title: c.title, text: `${c.title} 설명`, cardType: c.type, aliases: [], tags: [] })),
    relationships: cards
      .flatMap((c, a) => (c.links ?? []).map(({ to, label }) => ({ sourceCardId: String(a), targetCardId: idOf.get(to) ?? to, label: label ?? '' })))
      .map((r, n) => ({ id: `r${n}`, ...r })),
    relationshipStatus: 'current',
  }
}
// 메모리 데모 세계관 26개의 상세(데모 배열 순서). 카드 id는 카드 위치다.
const demoRepo = new InMemoryPublicWorldRepository()
const DEMO = await Promise.all(DEMO_WORLDS.map(async (w) => (await demoRepo.get(w.id))!))

// 오르↔미라(스승-제자)·미라↔하엘(의심)은 인물끼리의 관계, 오르→새벽항은 장소로 가는 연관이다. 끊긴 대상·자기 참조·반대 방향 중복이 섞여 있다.
const sample = world([
  card('오르', 'character', [{ to: '미라', label: '스승-제자' }, { to: '새벽항', label: '거점' }, { to: '없는 카드', label: '끊김' }, { to: '오르', label: '자기' }]),
  card('미라', 'character', [{ to: '오르', label: '제자-스승' }, { to: '하엘', label: '의심' }]),
  card('하엘', 'character'),
  card('새벽항', 'location'),
  card('금기', 'rule'),
])
// 배열 순서(장소·규칙·인물·인물·사건)와 설정집 순서(인물 → 장소 → 규칙 → 사건)가 다르다. 장소↔인물은 서로를 가리킨다.
const mixed = world([
  card('a장소', 'location', [{ to: 'c인물', label: '거주' }]),
  card('b규칙', 'rule'),
  card('c인물', 'character', [{ to: 'd인물', label: '동료' }, { to: 'a장소', label: '방문' }]),
  card('d인물', 'character'),
  card('e사건', 'event', [{ to: 'b규칙', label: '계기' }, { to: 'a장소', label: '무대' }, { to: 'd인물', label: '목격' }]),
])
// 능력·사물·기타는 한 묶음(기타)이다.
const misc = world([card('빗결 보법', 'ability'), card('씨앗 책', 'object'), card('우주관', 'other'), card('항구', 'location')])
// 단원→길드(소속), 길드→후원자(후원): 조직과 이어진 인물은 어느 쪽이 썼든 소속을 가진다.
const guild = world([
  card('길드', 'organization', [{ to: '후원자', label: '후원' }]),
  card('단원', 'character', [{ to: '길드', label: '소속' }]),
  card('후원자', 'character'),
])

/** 링크를 읽기 쉬운 [출발 이름, 도착 이름, 라벨]로 */
const edges = (graph: DetailGraph, kind: 'world' | 'link') => {
  const name = new Map(graph.nodes.map((n) => [n.id, n.name]))
  return graph.links.filter((l) => l.kind === kind).map((l) => [name.get(detailEndpoint(l.source)), name.get(detailEndpoint(l.target)), l.label])
}
/** 목록을 `제목` 또는 `제목·라벨`로 */
const names = (refs: CardRef[]) => refs.map((r) => (r.label ? `${r.title}·${r.label}` : r.title))
const page = (w: PublicWorld, title: string) => cardPage(w, String(w.cards.findIndex((c) => c.title === title)))!

describe('cardPairs', () => {
  it('없는 대상과 자기 참조는 버리고 같은 두 카드를 잇는 중복은 방향과 상관없이 먼저 나온 하나만 남긴다', () => {
    expect(cardPairs(sample)).toEqual([{ a: 0, b: 1, label: '스승-제자' }, { a: 0, b: 3, label: '거점' }, { a: 1, b: 2, label: '의심' }])
  })

  it('연관이 없는 세계관은 빈 목록이다', () => {
    expect(cardPairs(world([card('혼자', 'other')]))).toEqual([])
  })
})

describe('buildSettingGraph', () => {
  it('카드마다 유형 색 노드를 만들고 세계관을 중심 노드로 맨 뒤에 둬 위에 그려지고 먼저 클릭되게 한다', () => {
    const graph = buildSettingGraph(sample)
    expect(graph.nodes.map((n) => [n.id, n.name, n.kind])).toEqual([
      ['card:0', '오르', '인물'], ['card:1', '미라', '인물'], ['card:2', '하엘', '인물'], ['card:3', '새벽항', '장소'], ['card:4', '금기', '규칙'], ['world', '시험 세계', '세계관'],
    ])
    expect(graph.nodes.map((n) => n.color)).toEqual([CARD_COLORS.인물, CARD_COLORS.인물, CARD_COLORS.인물, CARD_COLORS.장소, CARD_COLORS.규칙, GENRE_COLORS.판타지])
  })

  it('카드 노드는 누르면 그 카드의 페이지로, 세계관 중심 노드는 설정집 탭으로 가는 주소(to)를 가진다', () => {
    expect(buildSettingGraph(sample).nodes.map((n) => n.to)).toEqual([...[0, 1, 2, 3, 4].map((i) => cardPath('w', i)), bookPath('w')])
  })

  it('중심에서 카드마다 옅은 선 하나를, 카드끼리는 연관마다 선 하나를 긋는다', () => {
    const graph = buildSettingGraph(sample)
    expect(edges(graph, 'world')).toEqual(['오르', '미라', '하엘', '새벽항', '금기'].map((name) => ['시험 세계', name, undefined]))
    expect(edges(graph, 'link')).toEqual([['오르', '미라', '스승-제자'], ['오르', '새벽항', '거점'], ['미라', '하엘', '의심']])
  })

  it('카드가 없는 세계관은 중심 노드 하나뿐이다', () => {
    const graph = buildSettingGraph(world([]))
    expect(graph.nodes.map((n) => n.id)).toEqual(['world'])
    expect(graph.links).toEqual([])
  })

  it('부를 때마다 새 객체를 돌려줘 ForceGraph가 노드·링크를 바꿔도 다음 그래프가 오염되지 않는다', () => {
    const first = buildSettingGraph(sample)
    first.links[0].source = first.nodes[2] // ForceGraph가 끝점을 노드 객체로 바꾸고 좌표를 붙이는 것을 흉내
    first.nodes[0].x = 99
    const second = buildSettingGraph(sample)
    expect(second).toEqual(buildSettingGraph(sample))
    expect(typeof second.links[0].source).toBe('string')
    expect(second.nodes[0].x).toBeUndefined()
  })
})

describe('buildCharacterGraph', () => {
  it('인물 카드만 노드가 되고 인물끼리의 관계만 라벨 있는 선이 된다(장소로 가는 연관은 뺀다)', () => {
    const graph = buildCharacterGraph(sample)
    expect(graph.nodes.map((n) => [n.id, n.name, n.color])).toEqual([['card:0', '오르', CARD_COLORS.인물], ['card:1', '미라', CARD_COLORS.인물], ['card:2', '하엘', CARD_COLORS.인물]])
    expect(edges(graph, 'link')).toEqual([['오르', '미라', '스승-제자'], ['미라', '하엘', '의심']])
    expect(graph.links.every((l) => l.kind === 'link')).toBe(true)
  })

  it('인물이 둘 미만이면 선이 없다(화면은 빈 상태 문구를 보인다)', () => {
    const graph = buildCharacterGraph(world([card('혼자', 'character', [{ to: '새벽항', label: '거점' }]), card('새벽항', 'location')]))
    expect(graph.nodes.map((n) => n.name)).toEqual(['혼자'])
    expect(graph.links).toEqual([])
    expect(buildCharacterGraph(world([card('새벽항', 'location')])).nodes).toEqual([])
  })
})

describe('showsDetailLabel', () => {
  const node = (kind: DetailNode['kind'], id = 'n'): DetailNode => ({ id, name: id, kind, color: '#ffffff', to: id })

  it('노드가 30개 이하면 모든 이름을 늘 그린다', () => {
    expect(LABEL_ALL_MAX).toBe(30)
    expect(showsDetailLabel(node('인물'), LABEL_ALL_MAX)).toBe(true)
  })

  it('그보다 많으면 중심 노드와 마우스를 올린 노드만 그린다', () => {
    expect(showsDetailLabel(node('인물'), LABEL_ALL_MAX + 1)).toBe(false)
    expect(showsDetailLabel(node('인물', 'x'), LABEL_ALL_MAX + 1, 'x')).toBe(true)
    expect(showsDetailLabel(node('세계관'), LABEL_ALL_MAX + 1)).toBe(true)
  })
})

describe('parseDetailTab', () => {
  it('?tab 값이 세 탭 중 하나면 그 탭이고 없거나 모르는 값이면 설정 그래프다', () => {
    expect(['graph', 'people', 'book'].map(parseDetailTab)).toEqual(['graph', 'people', 'book'])
    expect([null, '', 'map', 'BOOK'].map(parseDetailTab)).toEqual(['graph', 'graph', 'graph', 'graph'])
  })
})

describe('cardPath·bookPath', () => {
  it('카드 페이지는 /worlds/:id/cards/:cardId이고 설정집은 ?tab=book에 유형 필터(type)를 실을 수 있다', () => {
    expect(cardPath('moonhalo-isles', 3)).toBe('/worlds/moonhalo-isles/cards/3')
    expect(bookPath('w')).toBe('/worlds/w?tab=book')
    const url = new URL(bookPath('w', '기타'), 'http://x')
    expect([url.pathname, url.searchParams.get('tab'), url.searchParams.get('type')]).toEqual(['/worlds/w', 'book', '기타'])
  })
})

describe('cardPage', () => {
  it('카드 번호(cardId)로 카드를 찾고 없는 번호·번호가 아닌 값은 undefined다', () => {
    expect(cardPage(sample, '3')?.card).toEqual({ cardId: '3', title: '새벽항', text: '새벽항 설명', type: '장소', kind: '장소', aliases: [], tags: [] })
    for (const id of ['', '5', '-1', '1.5', '01', ' 1', '1e0', 'abc']) expect(cardPage(sample, id), id).toBeUndefined()
  })

  it('카드의 별칭·태그를 그대로 싣고 본문은 마크다운 원문 그대로 둔다', () => {
    const tagged: PublicWorld = { ...world([]), cards: [{ id: 'c-1', title: '하린', text: '**교신사**', cardType: 'character', aliases: ['린', '교신사'], tags: ['주인공'] }] }
    expect(cardPage(tagged, 'c-1')?.card).toEqual({ cardId: 'c-1', title: '하린', text: '**교신사**', type: '인물', kind: '인물', aliases: ['린', '교신사'], tags: ['주인공'] })
  })

  it('인물 카드는 다른 인물과의 관계를 relations로, 인물 밖의 연관을 links·backlinks로 나눠 한 카드가 한 목록에만 나온다', () => {
    const [orr, mira, haer] = ['오르', '미라', '하엘'].map((t) => page(sample, t))
    expect([names(orr.relations), names(orr.links), names(orr.backlinks)]).toEqual([['미라·스승-제자'], ['새벽항·거점'], []])
    expect([names(mira.relations), names(mira.links), names(mira.backlinks)]).toEqual([['오르·스승-제자', '하엘·의심'], [], []])
    expect(names(haer.relations)).toEqual(['미라·의심'])
  })

  it('인물이 아닌 카드는 관계 없이 자기 연관을 links로, 자기를 가리키는 카드를 인물이어도 backlinks로 보인다', () => {
    const harbor = page(sample, '새벽항')
    expect([names(harbor.relations), names(harbor.links), names(harbor.backlinks)]).toEqual([[], [], ['오르·거점']])
  })

  it('같은 두 카드를 서로 가리켜도 한 번만 나오고(먼저 쓴 쪽 방향·라벨) 없는 대상·자기 참조는 나오지 않는다', () => {
    const [orr, mira] = [page(sample, '오르'), page(sample, '미라')]
    const all = (p: NonNullable<ReturnType<typeof cardPage>>) => names([...p.relations, ...p.links, ...p.backlinks])
    expect(all(orr)).toEqual(['미라·스승-제자', '새벽항·거점'])
    expect(all(mira)).toEqual(['오르·스승-제자', '하엘·의심']) // 제자-스승이 아니라 먼저 쓴 스승-제자
    // 장소→인물('거주')을 쓴 뒤 인물→장소('방문')를 또 써도 장소의 links·인물의 backlinks에 한 번
    expect(names(page(mixed, 'a장소').links)).toEqual(['c인물·거주'])
    expect([names(page(mixed, 'c인물').links), names(page(mixed, 'c인물').backlinks)]).toEqual([[], ['a장소·거주']])
  })

  it('연관 목록은 쓴 순서가 아니라 설정집 순서(유형 묶음 순서 → 카드 순서)로 나온다', () => {
    expect(names(page(mixed, 'e사건').links)).toEqual(['d인물·목격', 'a장소·무대', 'b규칙·계기']) // 쓴 순서는 규칙·장소·인물
  })

  it('같은 유형 목록은 같은 묶음의 다른 카드를 설정집 순서로 보이고 능력·사물·기타는 한 묶음이다', () => {
    expect(names(page(sample, '오르').sameType)).toEqual(['미라', '하엘'])
    expect(page(sample, '새벽항').sameType).toEqual([])
    expect(page(misc, '빗결 보법').sameType.map((r) => [r.title, r.type])).toEqual([['씨앗 책', '사물'], ['우주관', '기타']])
  })

  it('이전·다음은 세계관 전체를 설정집 순서로 이어서 첫 카드는 이전이, 끝 카드는 다음이 없다', () => {
    // 설정집 순서: c인물 → d인물 → a장소 → b규칙 → e사건
    expect([page(mixed, 'c인물').prev, page(mixed, 'c인물').next?.title]).toEqual([undefined, 'd인물'])
    expect([page(mixed, 'a장소').prev?.title, page(mixed, 'a장소').next?.title]).toEqual(['d인물', 'b규칙'])
    expect([page(mixed, 'e사건').prev?.title, page(mixed, 'e사건').next]).toEqual(['b규칙', undefined])
  })

  it('인물의 소속은 어느 쪽이 썼든 이어진 조직 카드이고 인물이 아닌 카드에는 없다', () => {
    expect(names(page(guild, '단원').affiliations)).toEqual(['길드·소속'])
    expect(names(page(guild, '후원자').affiliations)).toEqual(['길드·후원'])
    expect(page(guild, '길드').affiliations).toEqual([])
    expect(page(sample, '오르').affiliations).toEqual([])
  })
})

describe('서버 카드 id(위치와 다른 id)로 이은 세계관', () => {
  // 카드 위치와 id가 다르고 관계는 양 끝 카드 id로만 이어진다(서버 응답 모양). 반대 방향 중복·없는 카드·라벨 없는 관계가 섞여 있다.
  const card9 = { id: 'c-9', title: '오르', text: '항해사', cardType: 'character' as const, aliases: [], tags: [] }
  const server: PublicWorld = {
    ...world([]),
    cards: [card9, { ...card9, id: 'c-3', title: '미라', text: '견습생' }, { ...card9, id: 'c-7', title: '새벽항', text: '항구', cardType: 'location' }],
    relationships: [
      { id: 'r-1', sourceCardId: 'c-9', targetCardId: 'c-3', label: '스승-제자' },
      { id: 'r-2', sourceCardId: 'c-7', targetCardId: 'c-9', label: '머무는 곳' },
      { id: 'r-3', sourceCardId: 'c-3', targetCardId: 'c-9', label: '제자-스승' },
      { id: 'r-4', sourceCardId: 'c-9', targetCardId: 'ghost', label: '끊김' },
      { id: 'r-5', sourceCardId: 'c-7', targetCardId: 'c-3', label: '' },
    ],
  }

  it('그래프 노드 id와 누르면 가는 주소는 카드 id를 쓴다', () => {
    expect(buildSettingGraph(server).nodes.map((n) => [n.id, n.to])).toEqual([
      ['card:c-9', cardPath('w', 'c-9')], ['card:c-3', cardPath('w', 'c-3')], ['card:c-7', cardPath('w', 'c-7')], ['world', bookPath('w')],
    ])
  })

  it('관계는 양 끝 카드 id로 카드를 찾고 없는 카드·반대 방향 중복은 버리며 빈 라벨은 라벨 없음이다', () => {
    expect(cardPairs(server)).toEqual([{ a: 0, b: 1, label: '스승-제자' }, { a: 2, b: 0, label: '머무는 곳' }, { a: 2, b: 1, label: undefined }])
    expect(edges(buildSettingGraph(server), 'link')).toEqual([['오르', '미라', '스승-제자'], ['새벽항', '오르', '머무는 곳'], ['새벽항', '미라', undefined]])
  })

  it('인물관계도는 인물끼리의 관계만 카드 id로 이은 노드를 쓴다', () => {
    const graph = buildCharacterGraph(server)
    expect(graph.nodes.map((n) => n.id)).toEqual(['card:c-9', 'card:c-3'])
    expect(edges(graph, 'link')).toEqual([['오르', '미라', '스승-제자']])
  })

  it('카드 페이지는 카드 id로 찾고 위치 번호나 모르는 id는 undefined다', () => {
    expect(cardPage(server, 'c-3')?.card).toEqual({ cardId: 'c-3', title: '미라', text: '견습생', type: '인물', kind: '인물', aliases: [], tags: [] })
    for (const id of ['1', '0', 'ghost', 'C-3', '']) expect(cardPage(server, id), id).toBeUndefined()
  })

  it('게시판 줄·이전·다음·관계 목록이 모두 카드 id를 가리킨다', () => {
    expect(bookRows(server).map((r) => r.cardId)).toEqual(['c-9', 'c-3', 'c-7'])
    const orr = cardPage(server, 'c-9')!
    expect([orr.relations.map((r) => r.cardId), orr.backlinks.map((r) => r.cardId), orr.next?.cardId, orr.prev?.cardId]).toEqual([['c-3'], ['c-7'], 'c-3', undefined])
  })

  it('관계가 없는 세계관(관계 상태 unavailable 포함)은 카드만 있고 연결이 없다', () => {
    const none = { ...server, relationships: [], relationshipStatus: 'unavailable' as const }
    expect(cardPairs(none)).toEqual([])
    expect(buildSettingGraph(none).links.filter((l) => l.kind === 'link')).toEqual([])
    expect(buildCharacterGraph(none).links).toEqual([])
    expect(bookRows(none).map((r) => r.connections)).toEqual([0, 0, 0])
  })
})

describe('bookRows', () => {
  const titles = (w: PublicWorld, filter?: Parameters<typeof bookRows>[1]) => bookRows(w, filter).map((r) => r.title)

  it('카드를 설정집 순서(인물·장소·조직·규칙·사건·기타 순, 같은 묶음 안에서는 카드 순서)로 한 줄씩 내고 순번을 1부터 매긴다', () => {
    expect(bookRows(mixed).map((r) => [r.no, r.title])).toEqual([[1, 'c인물'], [2, 'd인물'], [3, 'a장소'], [4, 'b규칙'], [5, 'e사건']])
    expect(bookRows(misc).map((r) => [r.title, r.type, r.kind])).toEqual([['항구', '장소', '장소'], ['빗결 보법', '능력', '기타'], ['씨앗 책', '사물', '기타'], ['우주관', '기타', '기타']])
  })

  it('한 줄은 카드 주소용 cardId·제목·본문·유형과 연결 수(관계+연관)·제목 옆 수(인물은 인물 관계 수, 그 밖은 연결 수)를 가진다', () => {
    expect(bookRows(sample).find((r) => r.title === '하엘')).toEqual({ cardId: '2', title: '하엘', text: '하엘 설명', type: '인물', kind: '인물', no: 3, connections: 1, badge: 1 })
    // 오르는 미라(인물 관계)와 새벽항(설정 연관)에 이어져 연결 2·관계 1이다
    expect(bookRows(sample).map((r) => [r.title, r.connections, r.badge])).toEqual([['오르', 2, 1], ['미라', 2, 2], ['하엘', 1, 1], ['새벽항', 1, 1], ['금기', 0, 0]])
  })

  it('요약(text)은 마크다운 기호를 벗긴 한 줄이고 검색어도 벗긴 글자에 맞춘다', () => {
    const marked: PublicWorld = { ...world([]), cards: [{ id: 'c-1', title: '하린', text: '**성격**: 차분함\n\n- [달](https://example.test)을 본다', cardType: 'character', aliases: [], tags: [] }] }
    expect(bookRows(marked).map((r) => r.text)).toEqual(['성격: 차분함 달을 본다'])
    expect(titles(marked, { query: '성격: 차분함' })).toEqual(['하린'])
  })

  it('유형 필터와 검색어(제목 또는 본문, 대소문자·앞뒤 공백 무시)가 함께 적용되고 순번은 보이는 목록 기준이다', () => {
    expect(titles(mixed, { kind: '인물' })).toEqual(['c인물', 'd인물'])
    expect(bookRows(mixed, { kind: '장소' }).map((r) => r.no)).toEqual([1])
    expect(titles(mixed, { query: ' A장소 ' })).toEqual(['a장소'])
    expect(titles(mixed, { query: '설명' })).toEqual(['c인물', 'd인물', 'a장소', 'b규칙', 'e사건']) // 본문에만 있는 글자
    expect(titles(mixed, { kind: '인물', query: 'D' })).toEqual(['d인물'])
    expect(titles(mixed, { kind: '장소', query: 'D' })).toEqual([])
    expect(titles(mixed, { query: '없는 글자' })).toEqual([])
    expect(titles(mixed, { query: '   ' })).toEqual(['c인물', 'd인물', 'a장소', 'b규칙', 'e사건'])
    expect(titles(world([card('SF 정거장', 'location')]), { query: 'sf' })).toEqual(['SF 정거장']) // 제목의 대문자도 무시
  })

  it('연결 많은 순은 연결 수 내림차순(같으면 설정집 순서), 가나다순은 제목 순이고 순번은 정렬한 순서대로 매긴다', () => {
    expect(bookRows(mixed, { sort: 'links' }).map((r) => [r.no, r.title, r.connections])).toEqual([[1, 'e사건', 3], [2, 'c인물', 2], [3, 'd인물', 2], [4, 'a장소', 2], [5, 'b규칙', 1]])
    const korean = world([card('다 항구', 'location'), card('가 항구', 'location'), card('나 항구', 'location')])
    expect(bookRows(korean, { sort: 'name' }).map((r) => [r.no, r.title])).toEqual([[1, '가 항구'], [2, '나 항구'], [3, '다 항구']])
    expect(titles(korean, { sort: 'book' })).toEqual(['다 항구', '가 항구', '나 항구'])
  })
})

describe('kindCounts·parseBookKind', () => {
  it('카드가 있는 유형 묶음과 장수를 설정집 순서로 준다', () => {
    expect(kindCounts(sample)).toEqual([{ kind: '인물', count: 3 }, { kind: '장소', count: 1 }, { kind: '규칙', count: 1 }])
    expect(kindCounts(misc)).toEqual([{ kind: '장소', count: 1 }, { kind: '기타', count: 3 }])
    expect(kindCounts(world([]))).toEqual([])
  })

  it('?type 값은 그 세계관에 카드가 있는 유형 이름일 때만 받고 나머지는 전체(undefined)다', () => {
    const kinds = kindCounts(sample).map((k) => k.kind)
    expect(['인물', '규칙'].map((v) => parseBookKind(v, kinds))).toEqual(['인물', '규칙'])
    expect([null, '', '기타', '인물 ', 'character'].map((v) => parseBookKind(v, kinds))).toEqual([undefined, undefined, undefined, undefined, undefined])
  })
})

describe('데모 세계관의 설정집·그래프', () => {
  it('모든 세계관의 설정집 게시판은 어떤 정렬로도 카드를 한 번씩 보이고 순번이 1부터 이어진다', () => {
    for (const w of DEMO) {
      for (const [sort] of BOOK_SORTS) {
        const rows = bookRows(w, { sort })
        expect(new Set(rows.map((r) => r.cardId)).size, `${w.id} ${sort}`).toBe(w.cards.length)
        expect(rows.map((r) => r.no), `${w.id} ${sort}`).toEqual(w.cards.map((_, i) => i + 1))
      }
      expect(kindCounts(w).reduce((n, k) => n + k.count, 0), w.id).toBe(w.cards.length)
    }
  })

  it('모든 카드 페이지는 이전·다음을 따라가면 카드를 한 번씩 거치고 연결은 양쪽 카드에서 보이며 한 카드는 한 목록에만 나온다', () => {
    for (const w of DEMO) {
      const pages = w.cards.map((_, i) => cardPage(w, String(i))!)
      expect(pages.every(Boolean), w.id).toBe(true)
      const walk = [pages.find((p) => !p.prev)!]
      for (let n = 0; n < pages.length && walk.at(-1)!.next; n++) walk.push(cardPage(w, walk.at(-1)!.next!.cardId)!)
      expect(walk.map((p) => p.card.cardId).toSorted(), w.id).toEqual(pages.map((p) => p.card.cardId).toSorted())
      for (const p of pages) {
        const refs = [...p.relations, ...p.links, ...p.backlinks]
        expect(new Set(refs.map((r) => r.cardId)).size, `${w.id} ${p.card.title}`).toBe(refs.length)
        for (const r of refs) {
          expect(r.cardId, `${w.id} ${p.card.title}`).not.toBe(p.card.cardId)
          const back = cardPage(w, r.cardId)!
          expect([...back.relations, ...back.links, ...back.backlinks].some((x) => x.cardId === p.card.cardId), `${w.id} ${p.card.title} ↔ ${r.title}`).toBe(true)
        }
      }
    }
  })

  it('그래프의 카드·인물 노드가 가리키는 주소는 모두 그 세계관의 실제 카드 페이지다', () => {
    for (const w of DEMO) {
      for (const n of [...buildSettingGraph(w).nodes.slice(0, -1), ...buildCharacterGraph(w).nodes]) {
        const id = new RegExp(`^${cardPath(w.id, '(\\d+)')}$`).exec(n.to)?.[1]
        expect(cardPage(w, id ?? '')?.card.title, `${w.id} ${n.name}`).toBe(n.name)
      }
    }
  })

  it('상위 8개 세계관은 인물 2~4명·라벨 있는 인물 관계 2~5개·인물 밖 설정 연관 3개 이상을 갖춰 세 탭이 모두 풍성하다', () => {
    for (const w of DEMO.slice(0, 8)) {
      const person = (i: number) => w.cards[i].cardType === 'character'
      const pairs = cardPairs(w)
      const relations = pairs.filter((p) => person(p.a) && person(p.b))
      expect(w.cards.filter((c) => c.cardType === 'character').length, `${w.id} 인물`).toBeGreaterThanOrEqual(2)
      expect(w.cards.filter((c) => c.cardType === 'character').length, `${w.id} 인물`).toBeLessThanOrEqual(4)
      expect(relations.length, `${w.id} 관계`).toBeGreaterThanOrEqual(2)
      expect(relations.length, `${w.id} 관계`).toBeLessThanOrEqual(5)
      expect(relations.every((p) => p.label), `${w.id} 관계 라벨`).toBe(true)
      expect(pairs.length - relations.length, `${w.id} 설정 연관`).toBeGreaterThanOrEqual(3)
      expect(buildCharacterGraph(w).links, w.id).toHaveLength(relations.length)
    }
  })
})

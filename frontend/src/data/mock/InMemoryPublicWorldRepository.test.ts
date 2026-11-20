import { describe, expect, it } from 'vitest'

import { PUBLIC_WORLD_GENRES } from '../../domain/entities/publicWorld'
import type { CardType } from '../../domain/entities/studioCards'
import { DEMO_WORLDS, type DemoWorld } from './demoPublicWorlds'
import { InMemoryPublicWorldRepository } from './InMemoryPublicWorldRepository'

const card = (title: string, type: CardType = 'other', links?: DemoWorld['cards'][number]['links']) => ({ type, title, text: `${title} 설명`, ...(links ? { links } : {}) })
const world = (id: string, extra: Partial<DemoWorld> = {}): DemoWorld => ({
  id, name: `${id} 세계`, hook: '소개', genre: 'fantasy', author: '작가', description: '설명', cards: [card(`${id} 카드 1`), card(`${id} 카드 2`, 'character')], ...extra,
})
const all = { page: 0, size: 100 }

describe('메모리 공개 세계관 목록', () => {
  it('공개 시각 최신 순(데모 배열의 뒤쪽이 최근)으로 돌려주고 데모 응답 표시를 단다', async () => {
    const page = await new InMemoryPublicWorldRepository().list(all)
    expect(page.items.map((w) => w.id)).toEqual(DEMO_WORLDS.map((w) => w.id).toReversed())
    const times = page.items.map((w) => Date.parse(w.publishedAt))
    expect(times).toEqual(times.toSorted((a, b) => b - a))
    expect(new Set(times).size).toBe(times.length)
    expect(page).toMatchObject({ page: 0, size: 100, total: DEMO_WORLDS.length, demo: true })
  })

  it('장르 코드를 쿼리로 받아 그 장르의 세계관만 같은 순서로 남기고 total도 그 수다', async () => {
    const repo = new InMemoryPublicWorldRepository([world('a'), world('b', { genre: 'sf' }), world('c')])
    const page = await repo.list({ genre: 'fantasy', ...all })
    expect(page.items.map((w) => w.id)).toEqual(['c', 'a'])
    expect(page.total).toBe(2)
    expect((await repo.list({ genre: 'wuxia', ...all })).items).toEqual([])
  })

  it('쪽과 크기로 자르고 total은 자르기 전 전체 수다', async () => {
    const repo = new InMemoryPublicWorldRepository(['a', 'b', 'c', 'd', 'e'].map((id) => world(id)))
    expect((await repo.list({ page: 0, size: 2 })).items.map((w) => w.id)).toEqual(['e', 'd'])
    const last = await repo.list({ page: 2, size: 2 })
    expect([last.items.map((w) => w.id), last.page, last.size, last.total]).toEqual([['a'], 2, 2, 5])
    expect((await repo.list({ page: 3, size: 2 })).items).toEqual([])
  })

  it('요약은 서버 목록과 같은 필드에 카드 수·관계 수와 데모 전용 지도 입력(카드 점·파생·조합 원본)을 더한다', async () => {
    const repo = new InMemoryPublicWorldRepository([
      world('origin', { cards: [card('하나', 'character', [{ to: '둘', label: '친구' }]), card('둘', 'location')] }),
      world('child', { derivedFrom: 'origin' }),
      world('mix', { combinedFrom: ['origin', 'child'] }),
    ])
    const byId = new Map((await repo.list(all)).items.map((w) => [w.id, w]))
    expect(byId.get('origin')).toMatchObject({
      id: 'origin', name: 'origin 세계', description: '설명', genre: 'fantasy', authorNickname: '작가', cardCount: 2, relationshipCount: 1,
      cards: [{ id: '0', title: '하나', cardType: 'character' }, { id: '1', title: '둘', cardType: 'location' }],
    })
    expect(byId.get('origin')?.derivedFrom).toBeUndefined()
    expect(byId.get('child')?.derivedFrom).toBe('origin')
    expect(byId.get('mix')?.combinedFrom).toEqual(['origin', 'child'])
    expect(byId.get('child')).not.toHaveProperty('hook') // 한 줄 소개는 상세에만 있다
  })
})

describe('메모리 공개 세계관 상세', () => {
  it('카드는 위치를 id로 삼고 카드 연관(제목으로 이은 links)을 서버와 같은 관계 목록으로 바꾼다', async () => {
    const repo = new InMemoryPublicWorldRepository([
      world('w', { cards: [card('오르', 'character', [{ to: '미라', label: '스승-제자' }, { to: '새벽항' }]), card('미라', 'character'), card('새벽항', 'location')] }),
    ])
    const found = await repo.get('w')
    expect(found).toMatchObject({ id: 'w', name: 'w 세계', description: '설명', genre: 'fantasy', authorNickname: '작가', revisionNo: 1, relationshipStatus: 'current', demo: true, hook: '소개' })
    expect(found?.cards).toEqual([
      { id: '0', title: '오르', text: '오르 설명', cardType: 'character', aliases: [], tags: [] },
      { id: '1', title: '미라', text: '미라 설명', cardType: 'character', aliases: [], tags: [] },
      { id: '2', title: '새벽항', text: '새벽항 설명', cardType: 'location', aliases: [], tags: [] },
    ])
    expect(found?.relationships.map((r) => [r.sourceCardId, r.targetCardId, r.label])).toEqual([['0', '1', '스승-제자'], ['0', '2', '']]) // 라벨이 없는 연관은 빈 라벨
    expect(new Set(found?.relationships.map((r) => r.id)).size).toBe(2)
  })

  it('목록의 공개 시각과 같은 값을 주고 작품이 없는 세계관은 빈 작품 목록이다(작품 연결을 지원하는 데모)', async () => {
    const repo = new InMemoryPublicWorldRepository([world('a'), world('b', { works: [{ title: '작품', author: '작가', episodes: 3, genre: 'fantasy' }] })])
    const listed = new Map((await repo.list(all)).items.map((w) => [w.id, w.publishedAt]))
    const [a, b] = await Promise.all([repo.get('a'), repo.get('b')])
    expect([a?.publishedAt, b?.publishedAt]).toEqual([listed.get('a'), listed.get('b')])
    expect([a?.works, b?.works]).toEqual([[], [{ title: '작품', author: '작가', episodes: 3, genre: 'fantasy' }]])
  })

  it('없는 세계관은 undefined다', async () => {
    expect(await new InMemoryPublicWorldRepository().get('없는-세계관')).toBeUndefined()
  })
})

describe('메모리 공개 세계관의 계보', () => {
  // a ← b(파생) ← c(재파생), d = a + c(조합), e는 어디에도 이어지지 않는다
  const sample = [
    world('a'), world('b', { derivedFrom: 'a' }), world('c', { derivedFrom: 'b' }), world('d', { combinedFrom: ['a', 'c'] }), world('e'),
  ]
  const lineageOf = async (id: string, worlds = sample) => (await new InMemoryPublicWorldRepository(worlds).get(id))?.lineage
  const ids = (refs: { id: string }[] | undefined) => refs?.map((r) => r.id)

  it('파생 원본·조합 원본·이 세계관에서 파생·조합된 세계관(목록 순서, 파생/조합 종류)을 돌려준다', async () => {
    const a = await lineageOf('a')
    expect([a?.derivedFrom, a?.combinedFrom, a?.children.map((c) => [c.id, c.kind])]).toEqual([undefined, [], [['b', 'derive'], ['d', 'combine']]])
    expect((await lineageOf('b'))?.derivedFrom?.id).toBe('a')
    expect((await lineageOf('b'))?.children.map((c) => c.id)).toEqual(['c'])
    expect(ids((await lineageOf('d'))?.combinedFrom)).toEqual(['a', 'c']) // 조합 원본은 조합에 적힌 순서
    expect((await lineageOf('d'))?.children).toEqual([])
    expect(await lineageOf('e')).toEqual({ combinedFrom: [], children: [] })
  })

  it('세계관 한 줄은 이름·장르·작가·카드 수를 담아 선반 카드가 바로 그린다', async () => {
    const [origin] = (await lineageOf('b'))!.children
    expect(origin).toEqual({ id: 'c', name: 'c 세계', genre: 'fantasy', authorNickname: '작가', cardCount: 2, kind: 'derive' })
  })

  const broken = [
    world('a'), world('x', { derivedFrom: 'ghost' }), world('y', { derivedFrom: 'y' }), world('z', { combinedFrom: ['z', 'ghost', 'a', 'a'] }),
  ]

  it('없는 원본과 자기 자신은 건너뛰고 조합 안의 중복 원본은 하나로 센다', async () => {
    expect((await lineageOf('x', broken))?.derivedFrom).toBeUndefined()
    expect((await lineageOf('y', broken))?.derivedFrom).toBeUndefined()
    expect(ids((await lineageOf('z', broken))?.combinedFrom)).toEqual(['a'])
    expect((await lineageOf('a', broken))?.children.map((c) => c.id)).toEqual(['z'])
  })

  it('데모 세계관에서 원본과 파생·조합은 서로의 반대편에서 보인다', async () => {
    const repo = new InMemoryPublicWorldRepository()
    for (const w of DEMO_WORLDS) {
      for (const child of (await repo.get(w.id))!.lineage!.children) {
        const back = (await repo.get(child.id))!.lineage!
        expect([back.derivedFrom, ...back.combinedFrom].map((r) => r?.id), `${w.id} → ${child.id}`).toContain(w.id)
        expect(child.kind, `${w.id} → ${child.id}`).toBe(DEMO_WORLDS.find((x) => x.id === child.id)!.derivedFrom === w.id ? 'derive' : 'combine')
      }
    }
  })
})

describe('메모리 데모 목록의 장르 쿼리', () => {
  it('계약의 장르 코드마다 그 장르의 데모 세계관이 하나 이상 나온다', async () => {
    const repo = new InMemoryPublicWorldRepository()
    for (const genre of PUBLIC_WORLD_GENRES) {
      const page = await repo.list({ genre, ...all })
      expect(page.total, genre).toBeGreaterThan(0)
      expect(page.items.every((w) => w.genre === genre), genre).toBe(true)
    }
  })
})

describe('메모리 공개 세계관 목록의 검색어 (#505)', () => {
  const repo = new InMemoryPublicWorldRepository([
    world('a', { name: '달무리 군도', description: '바다 위의 섬', author: '파도' }),
    world('b', { name: '침묵 궤도', description: '달이 없는 밤의 정거장', author: '궤도서기' }),
    world('c', { name: '사막 이야기', description: '모래', author: '달빛', genre: 'sf' }),
    world('d', { name: 'Neon City', description: 'rain', author: 'Kim', cards: [card('달무리 사원')] }),
  ])
  const ids = async (query: Partial<Parameters<typeof repo.list>[0]>) => (await repo.list({ ...all, ...query })).items.map((w) => w.id)

  it('이름·설명·작가에서 찾고 최근 공개 순을 지키며 total은 거른 수다', async () => {
    const page = await repo.list({ q: '달', ...all })
    expect(page.items.map((w) => w.id)).toEqual(['c', 'b', 'a']) // 작가(c)·설명(b)·이름(a), 카드 제목에만 있는 d는 뺀다
    expect(page.total).toBe(3)
  })

  it('대소문자와 앞뒤 공백을 무시한다', async () => {
    expect(await ids({ q: 'NEON' })).toEqual(['d'])
    expect(await ids({ q: '  neon city  ' })).toEqual(['d'])
  })

  it('설정 카드(제목·본문)는 세계관 검색에 쓰지 않는다', async () => {
    expect(await ids({ q: '사원' })).toEqual([])
    expect(await ids({ q: '카드 1 설명' })).toEqual([])
  })

  it('장르와 함께 쓰면 둘 다 맞는 세계관만 남고 쪽·total도 그 수다', async () => {
    const page = await repo.list({ q: '달', genre: 'fantasy', page: 0, size: 1 })
    expect([page.items.map((w) => w.id), page.total]).toEqual([['b'], 2])
    expect(await ids({ q: '달', genre: 'sf' })).toEqual(['c'])
  })

  it('검색어가 없거나 공백뿐이면 전체 목록과 같다', async () => {
    const everything = await ids({})
    expect(everything).toEqual(['d', 'c', 'b', 'a'])
    expect(await ids({ q: '' })).toEqual(everything)
    expect(await ids({ q: '   ' })).toEqual(everything)
  })
})

describe('메모리 설정 카드 검색 (#505)', () => {
  const repo = new InMemoryPublicWorldRepository([
    world('a', { name: 'A 세계', cards: [card('하엘 사원', 'location'), card('조석신 하엘', 'character'), card('새벽항')] }),
    world('b', { name: 'B 세계', cards: [card('하엘의 노래'), card('무관한 카드')] }),
  ])
  const hits = async (q: string) => (await repo.searchCards({ q, page: 0, size: 100 })).items

  it('카드 제목에서 앞뒤 공백을 무시한 부분 일치로 찾고 세계관 최근 공개 순 → 카드 제목 가나다 순으로 돌려준다', async () => {
    expect((await hits('  하엘 ')).map((h) => [h.worldId, h.title])).toEqual([['b', '하엘의 노래'], ['a', '조석신 하엘'], ['a', '하엘 사원']])
  })

  it('영문 제목은 대소문자를 무시하고 본문·세계관 이름에만 있는 글자는 찾지 않는다', async () => {
    const english = new InMemoryPublicWorldRepository([world('e', { cards: [card('Moon Gate')] })])
    expect((await english.searchCards({ q: 'moon GATE', page: 0, size: 24 })).items.map((h) => h.title)).toEqual(['Moon Gate'])
    expect(await hits('설명')).toEqual([]) // 이 카드들의 본문은 모두 '<제목> 설명'이다
    expect(await hits('A 세계')).toEqual([]) // 세계관 이름은 세계관 검색의 몫이다
  })

  it('결과는 세계관 상세와 같은 위치 id와 세계관 id·이름·유형을 싣고 이미지·별칭·태그는 비어 있다(데모 카드에는 없다)', async () => {
    expect((await hits('조석신'))[0]).toEqual({ worldId: 'a', worldName: 'A 세계', cardId: '1', title: '조석신 하엘', cardType: 'character', aliases: [], tags: [], imageId: null })
  })

  it('쪽과 크기로 자르고 total은 자르기 전 일치 수다', async () => {
    const page = await repo.searchCards({ q: '하엘', page: 1, size: 2 })
    expect([page.items.map((h) => h.title), page.page, page.size, page.total]).toEqual([['하엘 사원'], 1, 2, 3])
    expect((await repo.searchCards({ q: '하엘', page: 2, size: 2 })).items).toEqual([])
  })

  it('찾는 카드가 없으면 빈 결과이고 검색어가 비면(공백뿐 포함) 서버의 422처럼 거절한다', async () => {
    expect(await repo.searchCards({ q: '없는카드', page: 0, size: 24 })).toMatchObject({ items: [], total: 0 })
    for (const q of ['', '   ']) await expect(repo.searchCards({ q, page: 0, size: 24 })).rejects.toThrow('검색어')
  })

  it('데모 세계관에서 결과의 카드 id로 세계관 상세를 읽으면 같은 카드가 나온다(결과 링크가 맞는 카드를 연다)', async () => {
    const demo = new InMemoryPublicWorldRepository()
    const { items } = await demo.searchCards({ q: '서진', page: 0, size: 100 })
    expect(new Set(items.map((h) => h.worldId)).size).toBeGreaterThan(1)
    for (const hit of items) expect((await demo.get(hit.worldId))?.cards.find((c) => c.id === hit.cardId)?.title, `${hit.worldId}/${hit.cardId}`).toBe(hit.title)
  })
})

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

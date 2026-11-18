import { describe, expect, it, vi } from 'vitest'

import { HttpPublicWorldRepository } from './HttpPublicWorldRepository'

const summary = (extra: Record<string, unknown> = {}) => ({
  id: 'w-1', name: '달무리 군도', description: '달이 질 때마다 섬이 흐르는 바다', genre: 'fantasy', authorNickname: '달무리', cardCount: 7, relationshipCount: 4,
  publishedAt: '2026-11-11T09:30:00Z', hasCover: false, ...extra,
})
const page = (extra: Record<string, unknown> = {}) => ({ items: [summary()], page: 0, size: 24, total: 1, ...extra })
const world = (extra: Record<string, unknown> = {}) => ({
  id: 'w-1', name: '달무리 군도', description: '설명', genre: 'fantasy', authorNickname: '달무리', publishedAt: '2026-11-11T09:30:00Z', hasCover: false, revisionNo: 3,
  cards: [
    { id: 'c-1', title: '조석신 하엘', text: '달을 끄는 신', cardType: 'character', aliases: ['하엘'], tags: ['신'], imageId: null },
    { id: 'c-2', title: '새벽항', text: '오래된 항구', cardType: 'location', aliases: [], tags: [], imageId: null },
  ],
  relationships: [{ id: 'r-1', sourceCardId: 'c-1', targetCardId: 'c-2', label: '수호' }],
  relationshipStatus: 'current', linkedWork: null, ...extra,
})
const respond = (body: unknown, status = 200) => vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json(body, { status }))
const FORMAT = '서버 응답 형식을 확인할 수 없어요.'

describe('공개 세계관 목록 읽기 (공개 API, 인증 없음)', () => {
  it('관계 수 확인 실패(null)는 0으로 바꾸지 않는다', async () => {
    const result = await new HttpPublicWorldRepository(respond(page({ items: [summary({ relationshipCount: null }), summary({ id: 'w-2', relationshipCount: 0 })] }))).list({ page: 0, size: 24 })
    expect(result.items.map((item) => item.relationshipCount)).toEqual([null, 0])
  })
  it('장르·쪽·크기를 쿼리로 보내고 응답을 목록으로 바꾼다', async () => {
    const fetcher = respond(page({ items: [summary(), summary({ id: 'w-2', genre: null, cardCount: 0, relationshipCount: 0 })], total: 2 }))
    const result = await new HttpPublicWorldRepository(fetcher).list({ genre: 'fantasy', page: 0, size: 24 })
    expect(fetcher).toHaveBeenCalledWith('/api/v1/public/world-studios?genre=fantasy&page=0&size=24', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    expect(result).toMatchObject({ page: 0, size: 24, total: 2 })
    expect(result.items[0]).toEqual(summary())
    expect(result.items[1]).toMatchObject({ id: 'w-2', genre: null, cardCount: 0 }) // 장르 미지정은 null 그대로
  })

  it('장르를 주지 않으면 genre 쿼리를 싣지 않는다', async () => {
    const fetcher = respond(page())
    await new HttpPublicWorldRepository(fetcher).list({ page: 2, size: 10 })
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/public/world-studios?page=2&size=10')
  })

  it('로그인 상태와 상관없이 인증·CSRF 헤더를 보내지 않고 취소 신호를 이어 준다', async () => {
    const fetcher = respond(page())
    const controller = new AbortController()
    await new HttpPublicWorldRepository(fetcher).list({ page: 0, size: 24 }, controller.signal)
    const init = fetcher.mock.calls[0][1]!
    const headers = new Headers(init.headers)
    expect([headers.has('Authorization'), headers.has('X-CSRF-TOKEN')]).toEqual([false, false])
    expect(init.signal?.aborted).toBe(false)
    controller.abort()
    expect(init.signal?.aborted).toBe(true)
  })

  it('hasCover는 목록 응답마다 그대로 읽고, 필드가 없던 응답은 표지 없음(false)으로 읽는다', async () => {
    const { hasCover: _kept, ...withoutField } = summary({ id: 'w-3' }) // 필드가 없던 옛 응답
    const result = await new HttpPublicWorldRepository(respond(page({ items: [summary({ id: 'w-1', hasCover: true }), summary({ id: 'w-2', hasCover: false }), withoutField] }))).list({ page: 0, size: 24 })
    expect(result.items.map((w) => [w.id, w.hasCover])).toEqual([['w-1', true], ['w-2', false], ['w-3', false]])
    await expect(new HttpPublicWorldRepository(respond(page({ items: [summary({ hasCover: 'yes' })] }))).list({ page: 0, size: 24 })).rejects.toThrow(FORMAT)
  })

  it('빈 목록은 빈 배열이다', async () => {
    expect((await new HttpPublicWorldRepository(respond(page({ items: [], total: 0 }))).list({ page: 0, size: 24 })).items).toEqual([])
  })

  it('응답 형식이 계약과 다르면 빈 목록으로 숨기지 않고 던진다', async () => {
    const bad = [
      page({ items: [summary({ genre: 'horror' })] }), // 모르는 장르 코드
      page({ items: [summary({ cardCount: -1 })] }),
      page({ items: [summary({ publishedAt: '어제' })] }),
      page({ items: [{ id: 'x' }] }),
      page({ total: 'many' }),
      [summary()], // 배열이 아니라 객체여야 한다
    ]
    for (const body of bad) await expect(new HttpPublicWorldRepository(respond(body)).list({ page: 0, size: 24 })).rejects.toThrow(FORMAT)
  })

  it('실패 응답은 서버의 detail을, 읽을 수 없는 실패는 안내 문구를 던진다', async () => {
    await expect(new HttpPublicWorldRepository(respond({ detail: '잠시 후 다시 시도해 주세요.' }, 503)).list({ page: 0, size: 24 })).rejects.toThrow('잠시 후 다시 시도해 주세요.')
    await expect(new HttpPublicWorldRepository(vi.fn(async () => new Response('<html>', { status: 502 }))).list({ page: 0, size: 24 })).rejects.toThrow('요청을 처리하지 못했어요')
    await expect(new HttpPublicWorldRepository(vi.fn(async () => { throw new TypeError('network') })).list({ page: 0, size: 24 })).rejects.toThrow('network')
  })
})

describe('공개 세계관 상세 읽기', () => {
  it('관계 분류를 보존하고 이전 응답·null을 허용하며 잘못된 값은 거절한다', async () => {
    const relation = world().relationships[0]
    for (const category of ['structural', 'emotional', 'identity', null] as const) {
      const result = await new HttpPublicWorldRepository(respond(world({ relationships: [{ ...relation, category }] }))).get('w-1')
      expect(result?.relationships[0].category).toBe(category)
    }
    await expect(new HttpPublicWorldRepository(respond(world({ relationships: [{ ...relation, category: 'bad' }] }))).get('w-1')).rejects.toThrow(FORMAT)
  })
  it('관계 방향을 보존하고 이전 응답·null은 미상이며 잘못된 값은 거절한다', async () => {
    const relations = world().relationships
    const withDirection = (direction: unknown) => world({ relationships: [{ ...relations[0], direction }] })
    for (const direction of ['directed', 'symmetric', null] as const) {
      const result = await new HttpPublicWorldRepository(respond(withDirection(direction))).get('w-1')
      expect(result?.relationships[0].direction).toBe(direction)
    }
    expect((await new HttpPublicWorldRepository(respond(world())).get('w-1'))?.relationships[0].direction).toBeUndefined()
    await expect(new HttpPublicWorldRepository(respond(withDirection('other'))).get('w-1')).rejects.toThrow(FORMAT)
  })
  it('관계 본문과 극성을 읽고 잘못된 값은 거절한다', async () => {
    const relationship = { ...world().relationships[0], body: '원문\n설명', polarity: 'denied' }
    const found = await new HttpPublicWorldRepository(respond(world({ relationships: [relationship] }))).get('w-1')
    expect(found?.relationships[0]).toMatchObject({ body: '원문\n설명', polarity: 'denied' })
    for (const bad of [{ ...relationship, body: 1 }, { ...relationship, polarity: 'unknown' }]) await expect(new HttpPublicWorldRepository(respond(world({ relationships: [bad] }))).get('w-1')).rejects.toThrow(FORMAT)
  })
  it('공개 카드 만 장과 관계 천 개 이상을 절삭 없이 읽는다', async () => {
    const cards = Array.from({ length: 10000 }, (_, i) => ({ id: `c-${i}`, title: `설정 ${i}`, text: `# 원문\n출처 ${i}`, cardType: 'character', aliases: [], tags: [] }))
    const relationships = Array.from({ length: 1001 }, (_, i) => ({ id: `r-${i}`, sourceCardId: `c-${i}`, targetCardId: `c-${i + 1}`, label: '관계' }))
    const result = await new HttpPublicWorldRepository(respond(world({ cards, relationships }))).get('w-1')
    expect(result?.cards).toHaveLength(10000)
    expect(result?.cards[9999].text).toBe('# 원문\n출처 9999')
    expect(result?.relationships).toHaveLength(1001)
  })
  it('id를 경로에 싣고 카드·관계·관계 상태를 그대로 돌려준다', async () => {
    const fetcher = respond(world())
    const found = await new HttpPublicWorldRepository(fetcher).get('w-1')
    expect(fetcher).toHaveBeenCalledWith('/api/v1/public/world-studios/w-1', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    expect(found).toEqual(world())
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
  })

  it('상세의 hasCover를 읽고, 필드가 없던 응답은 표지 없음(false)으로 읽는다', async () => {
    expect((await new HttpPublicWorldRepository(respond(world({ hasCover: true }))).get('w-1'))?.hasCover).toBe(true)
    const { hasCover: _kept, ...withoutField } = world() // 필드가 없던 옛 응답
    expect((await new HttpPublicWorldRepository(respond(withoutField)).get('w-1'))?.hasCover).toBe(false)
    await expect(new HttpPublicWorldRepository(respond(world({ hasCover: 1 }))).get('w-1')).rejects.toThrow(FORMAT)
  })

  it('연결된 공개 소설(linkedWork)을 그대로 읽고, 없거나 null이면 연결 없음(null)으로 읽으며, 모양이 어긋나면 던진다', async () => {
    const linkedWork = { id: 'work-1', title: '달무리 항해기', authorNickname: '달무리', hasCover: true }
    expect((await new HttpPublicWorldRepository(respond(world({ linkedWork }))).get('w-1'))?.linkedWork).toEqual(linkedWork)
    expect((await new HttpPublicWorldRepository(respond(world({ linkedWork: null }))).get('w-1'))?.linkedWork).toBeNull()
    const { linkedWork: _kept, ...withoutField } = world() // 필드가 없던 옛 응답
    expect((await new HttpPublicWorldRepository(respond(withoutField)).get('w-1'))?.linkedWork).toBeNull()
    for (const bad of [{ ...linkedWork, title: undefined }, { ...linkedWork, hasCover: 'yes' }, { ...linkedWork, id: '' }, 'work-1']) {
      await expect(new HttpPublicWorldRepository(respond(world({ linkedWork: bad }))).get('w-1')).rejects.toThrow(FORMAT)
    }
  })

  it('카드의 imageId를 그대로 읽고, 필드가 없거나 null이면 이미지 없음(null)으로 읽으며, 문자열이 아니면 던진다', async () => {
    const cards = [
      { id: 'c-1', title: '조석신 하엘', text: '달을 끄는 신', cardType: 'character', aliases: [], tags: [], imageId: 'img-1' },
      { id: 'c-2', title: '새벽항', text: '오래된 항구', cardType: 'location', aliases: [], tags: [], imageId: null },
      { id: 'c-3', title: '등대', text: '', cardType: 'location', aliases: [], tags: [] }, // 필드가 없던 옛 응답
    ]
    const found = await new HttpPublicWorldRepository(respond(world({ cards }))).get('w-1')
    expect(found?.cards.map((card) => card.imageId)).toEqual(['img-1', null, null])
    await expect(new HttpPublicWorldRepository(respond(world({ cards: [{ ...cards[0], imageId: 7 }] }))).get('w-1')).rejects.toThrow(FORMAT)
    await expect(new HttpPublicWorldRepository(respond(world({ cards: [{ ...cards[0], imageId: '' }] }))).get('w-1')).rejects.toThrow(FORMAT)
  })

  it('경로에 넣는 id는 인코딩한다', async () => {
    const fetcher = respond(world({ id: 'a/b c' }))
    await new HttpPublicWorldRepository(fetcher).get('a/b c')
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/public/world-studios/a%2Fb%20c')
  })

  it('비공개·없는 세계관(404)은 오류가 아니라 undefined다', async () => {
    expect(await new HttpPublicWorldRepository(respond({ detail: '세계관을 찾을 수 없어요.' }, 404)).get('w-1')).toBeUndefined()
    expect(await new HttpPublicWorldRepository(vi.fn(async () => new Response(null, { status: 404 }))).get('w-1')).toBeUndefined()
  })

  it('UUID 형식이 아니라 서버가 400으로 거절한 id도 없는 세계관이라 찾을 수 없음(undefined)이다', async () => {
    const fetcher = respond({ detail: '세계관 id 형식이 올바르지 않아요.' }, 400)
    expect(await new HttpPublicWorldRepository(fetcher).get('없는-세계관')).toBeUndefined()
    expect(fetcher.mock.calls[0][0]).toBe(`/api/v1/public/world-studios/${encodeURIComponent('없는-세계관')}`)
  })

  it('주소에 대문자 UUID가 와도 서버가 소문자로 돌려준 같은 세계관이면 형식 오류가 아니라 그 세계관이다', async () => {
    const upper = '3F2504E0-4F89-41D3-9A0C-0305E82C3301'
    const found = await new HttpPublicWorldRepository(respond(world({ id: upper.toLowerCase() }))).get(upper)
    expect(found?.id).toBe(upper.toLowerCase())
  })

  it('404 말고 실패(500·네트워크)는 찾을 수 없음으로 바꾸지 않고 던진다', async () => {
    await expect(new HttpPublicWorldRepository(respond({ detail: '서버 오류' }, 500)).get('w-1')).rejects.toThrow('서버 오류')
    await expect(new HttpPublicWorldRepository(vi.fn(async () => { throw new TypeError('offline') })).get('w-1')).rejects.toThrow('offline')
  })

  it('관계를 못 불러온 상태(unavailable)는 빈 관계와 함께 카드를 그대로 받는다', async () => {
    const found = await new HttpPublicWorldRepository(respond(world({ relationships: [], relationshipStatus: 'unavailable' }))).get('w-1')
    expect(found).toMatchObject({ relationshipStatus: 'unavailable', relationships: [] })
    expect(found?.cards).toHaveLength(2)
  })

  it('응답 형식이 계약과 다르거나 다른 세계관이 오면 던진다', async () => {
    const bad = [
      world({ cards: [{ id: 'c-1', title: '카드', text: '', cardType: 'wizard', aliases: [], tags: [] }] }), // 모르는 카드 유형
      world({ relationshipStatus: 'partial' }),
      world({ relationships: [{ id: 'r', sourceCardId: 'c-1', label: '관계' }] }), // 끝점 하나 없음
      world({ revisionNo: 0 }),
      world({ authorNickname: undefined }),
      world({ id: 'other-world' }), // 요청한 id와 다름
    ]
    for (const body of bad) await expect(new HttpPublicWorldRepository(respond(body)).get('w-1')).rejects.toThrow(FORMAT)
  })
})

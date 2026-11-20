import { describe, expect, it, vi } from 'vitest'

import { InMemoryGenreRepository, InMemoryOperationsGenreRepository } from '../../data/mock/InMemoryGenreRepositories'
import type { PublicWorld, PublicWorldCardHit, PublicWorldCardPage, PublicWorldPage, PublicWorldSummary } from '../entities/publicWorld'
import type { GenreRepository } from '../repositories/GenreRepository'
import type { PublicWorldCardQuery, PublicWorldQuery, PublicWorldRepository } from '../repositories/PublicWorldRepository'
import { PUBLIC_WORLD_MAX_PAGES, PUBLIC_WORLD_PAGE_SIZE, PublicWorldUseCase } from '../usecases/PublicWorldUseCase'

/** 운영과 같은 메모리 목록의 공개 장르(시드 30개: genre-01 판타지, genre-14 SF …). */
const genres = (): GenreRepository => new InMemoryGenreRepository(new InMemoryOperationsGenreRepository())

const summary = (n: number): PublicWorldSummary => ({
  id: `w${n}`, name: `세계관 ${n}`, description: '설명', genre: 'genre-01', authorNickname: '작가', cardCount: 3, relationshipCount: 1,
  publishedAt: '2026-11-11T00:00:00Z',
})
/** 번호 from..to-1의 세계관 목록. 서버처럼 `page`·`size`로 자른 쪽을 돌려주는 가짜 저장소 */
const server = (total: number, serverSize = PUBLIC_WORLD_PAGE_SIZE) => {
  const all = Array.from({ length: total }, (_, n) => summary(n))
  const list = vi.fn(async ({ page, size }: PublicWorldQuery, _signal?: AbortSignal): Promise<PublicWorldPage> => {
    const used = Math.min(size, serverSize)
    return { items: all.slice(page * used, page * used + used), page, size: used, total }
  })
  const get = vi.fn(async (): Promise<PublicWorld | undefined> => undefined)
  const searchCards = vi.fn(async ({ page, size }: PublicWorldCardQuery, _signal?: AbortSignal): Promise<PublicWorldCardPage> => ({ items: [], page, size, total: 0 }))
  return { list, get, searchCards } satisfies PublicWorldRepository
}

describe('공개 세계관 목록', () => {
  it('한 쪽에 다 들어오면 첫 쪽만 요청하고 장르를 그대로 넘긴다', async () => {
    const repo = server(5)
    const page = await new PublicWorldUseCase(repo, genres()).list({ genre: 'genre-14' })
    expect(repo.list).toHaveBeenCalledTimes(1)
    expect(repo.list).toHaveBeenCalledWith({ genre: 'genre-14', page: 0, size: PUBLIC_WORLD_PAGE_SIZE }, undefined)
    expect(page.items.map((w) => w.id)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4'])
    expect(page.total).toBe(5)
  })

  it('장르를 안 주면 genre 쿼리 없이 전체를 요청한다', async () => {
    const repo = server(1)
    await new PublicWorldUseCase(repo, genres()).list()
    expect(Object.hasOwn(repo.list.mock.calls[0][0], 'genre')).toBe(false)
  })

  it('전체가 한 쪽을 넘으면 서버가 쓴 쪽 크기로 다음 쪽을 이어 붙여 최근 공개 순서를 지킨다', async () => {
    const repo = server(30)
    const { items, total } = await new PublicWorldUseCase(repo, genres()).list()
    expect(repo.list.mock.calls.map(([q]) => [q.page, q.size])).toEqual([[0, PUBLIC_WORLD_PAGE_SIZE], [1, PUBLIC_WORLD_PAGE_SIZE]])
    expect(items.map((w) => w.id)).toEqual(Array.from({ length: 30 }, (_, n) => `w${n}`))
    expect(total).toBe(30)
  })

  it('서버가 더 작은 쪽 크기를 쓰면 그 크기로 쪽을 나눠 요청해 빠지는 항목이 없다', async () => {
    const repo = server(25, 10)
    const { items } = await new PublicWorldUseCase(repo, genres()).list()
    expect(repo.list.mock.calls.map(([q]) => [q.page, q.size])).toEqual([[0, PUBLIC_WORLD_PAGE_SIZE], [1, 10], [2, 10]])
    expect(items).toHaveLength(25)
  })

  it(`최대 ${PUBLIC_WORLD_MAX_PAGES}쪽까지만 이어 붙이고 total은 서버가 센 전체 수를 그대로 둔다`, async () => {
    const repo = server(PUBLIC_WORLD_PAGE_SIZE * PUBLIC_WORLD_MAX_PAGES + 7)
    const { items, total } = await new PublicWorldUseCase(repo, genres()).list()
    expect(repo.list).toHaveBeenCalledTimes(PUBLIC_WORLD_MAX_PAGES)
    expect(items).toHaveLength(PUBLIC_WORLD_PAGE_SIZE * PUBLIC_WORLD_MAX_PAGES)
    expect(total).toBe(PUBLIC_WORLD_PAGE_SIZE * PUBLIC_WORLD_MAX_PAGES + 7)
  })

  it('중간 쪽이 비어 돌아오면(그 사이 목록이 줄어듦) 더 요청하지 않고 거기서 멈춘다', async () => {
    const repo = { list: vi.fn(async ({ page }: PublicWorldQuery): Promise<PublicWorldPage> => ({ items: page === 0 ? [summary(0)] : [], page, size: 1, total: 99 })), get: vi.fn(), searchCards: vi.fn() } satisfies PublicWorldRepository
    const { items } = await new PublicWorldUseCase(repo, genres()).list()
    expect(repo.list).toHaveBeenCalledTimes(2)
    expect(items.map((w) => w.id)).toEqual(['w0'])
  })

  it('쪽을 읽는 사이 목록이 밀려 같은 세계관이 두 쪽에 나오면 처음 나온 하나만 남긴다', async () => {
    const pages = [[summary(0), summary(1)], [summary(1), summary(2)]]
    const repo = { list: vi.fn(async ({ page }: PublicWorldQuery): Promise<PublicWorldPage> => ({ items: pages[page] ?? [], page, size: 2, total: 4 })), get: vi.fn(), searchCards: vi.fn() } satisfies PublicWorldRepository
    const { items } = await new PublicWorldUseCase(repo, genres()).list()
    expect(items.map((w) => w.id)).toEqual(['w0', 'w1', 'w2'])
  })

  it('취소 신호를 모든 쪽 요청에 넘기고 한 쪽이라도 실패하면 일부 결과로 숨기지 않고 던진다', async () => {
    const signal = new AbortController().signal
    const repo = server(30)
    await new PublicWorldUseCase(repo, genres()).list({}, signal)
    expect(repo.list.mock.calls.map(([, s]) => s)).toEqual([signal, signal])
    repo.list.mockImplementationOnce(async (q) => ({ items: [summary(0)], page: q.page, size: 1, total: 2 })).mockRejectedValueOnce(new Error('offline'))
    await expect(new PublicWorldUseCase(repo, genres()).list()).rejects.toThrow('offline')
  })
})

describe('공개 세계관 상세', () => {
  it('저장소 결과를 그대로 돌려주고 비공개·없는 세계관(undefined)도 그대로 알린다', async () => {
    const world = { id: 'w1' } as PublicWorld
    const repo = { list: vi.fn(), get: vi.fn(async (id: string) => (id === 'w1' ? world : undefined)), searchCards: vi.fn() } satisfies PublicWorldRepository
    const signal = new AbortController().signal
    const useCase = new PublicWorldUseCase(repo, genres())
    expect(await useCase.get('w1', signal)).toEqual({ ...world, genreName: null })
    expect(repo.get).toHaveBeenCalledWith('w1', signal)
    expect(await useCase.get('없음')).toBeUndefined()
  })
})

describe('공개 세계관·설정 카드 검색 (#505)', () => {
  const hit: PublicWorldCardHit = { worldId: 'w1', worldName: '달무리 군도', cardId: 'c1', title: '조석신 하엘', cardType: 'character', aliases: ['하엘'], tags: ['신'], imageId: null }

  it('세계관 검색은 검색어·쪽을 그대로 싣고 쪽 크기 24로 한 쪽만 읽는다(list처럼 쪽을 이어 붙이지 않는다)', async () => {
    const repo = server(60)
    const signal = new AbortController().signal
    const page = await new PublicWorldUseCase(repo, genres()).searchWorlds({ q: '달무리', page: 1 }, signal)
    expect(repo.list).toHaveBeenCalledTimes(1)
    expect(repo.list).toHaveBeenCalledWith({ q: '달무리', page: 1, size: PUBLIC_WORLD_PAGE_SIZE }, signal)
    expect(page.items.map((w) => w.id)).toEqual(Array.from({ length: PUBLIC_WORLD_PAGE_SIZE }, (_, n) => `w${PUBLIC_WORLD_PAGE_SIZE + n}`))
    expect(page.total).toBe(60)
  })

  it('설정 카드 검색도 한 쪽만 읽고 취소 신호를 넘기며 저장소 실패를 숨기지 않는다', async () => {
    const repo = server(0)
    repo.searchCards.mockResolvedValueOnce({ items: [hit], page: 2, size: PUBLIC_WORLD_PAGE_SIZE, total: 49 })
    const signal = new AbortController().signal
    const page = await new PublicWorldUseCase(repo, genres()).searchCards({ q: '하엘', page: 2 }, signal)
    expect(repo.searchCards).toHaveBeenCalledTimes(1)
    expect(repo.searchCards).toHaveBeenCalledWith({ q: '하엘', page: 2, size: PUBLIC_WORLD_PAGE_SIZE }, signal)
    expect(page).toEqual({ items: [hit], page: 2, size: PUBLIC_WORLD_PAGE_SIZE, total: 49 })
    repo.searchCards.mockRejectedValueOnce(new Error('offline'))
    await expect(new PublicWorldUseCase(repo, genres()).searchCards({ q: '하엘', page: 0 })).rejects.toThrow('offline')
  })

  it('쪽 크기를 줄 수 있고(전체 탭 묶음 6개·빠른 이동 3개) 주지 않으면 24개다', async () => {
    const repo = server(0)
    const useCase = new PublicWorldUseCase(repo, genres())
    await useCase.searchWorlds({ q: '달', page: 0, size: 3 })
    await useCase.searchCards({ q: '달', page: 2, size: 6 })
    expect(repo.list).toHaveBeenLastCalledWith({ q: '달', page: 0, size: 3 }, undefined)
    expect(repo.searchCards).toHaveBeenLastCalledWith({ q: '달', page: 2, size: 6 }, undefined)
    await useCase.searchWorlds({ q: '달', page: 0 })
    expect(repo.list).toHaveBeenLastCalledWith({ q: '달', page: 0, size: PUBLIC_WORLD_PAGE_SIZE }, undefined)
  })
})

describe('공개 세계관의 장르 이름(DEC-56)', () => {
  it('목록·검색·상세의 세계관에 공개 장르 목록으로 찾은 이름을 붙이고 장르 코드는 그대로 둔다', async () => {
    const repo = server(2)
    const useCase = new PublicWorldUseCase(repo, genres())
    expect((await useCase.list()).items.map((w) => [w.genre, w.genreName])).toEqual([['genre-01', '판타지'], ['genre-01', '판타지']])
    expect((await useCase.searchWorlds({ q: '', page: 0 })).items[0]).toMatchObject({ genre: 'genre-01', genreName: '판타지' })
    repo.get.mockResolvedValueOnce({ id: 'w1', genre: 'genre-14' } as PublicWorld)
    expect(await useCase.get('w1')).toMatchObject({ genre: 'genre-14', genreName: 'SF' })
  })

  it('숨겼거나 목록에 없는 장르 코드는 이름을 알 수 없어 코드를 보이지 않고 장르 없음처럼 둔다(genreName null)', async () => {
    const onlyFantasy: GenreRepository = { list: async () => [{ code: 'genre-01', name: '판타지', emoji: null, featured: false }] }
    const repo = server(0)
    repo.list.mockResolvedValueOnce({ items: [{ ...summary(1), genre: 'genre-14' }, { ...summary(2), genre: null }, summary(3)], page: 0, size: 24, total: 3 })
    const { items } = await new PublicWorldUseCase(repo, onlyFantasy).list()
    expect(items.map((w) => [w.genre, w.genreName])).toEqual([['genre-14', null], [null, null], ['genre-01', '판타지']])
  })

  it('상세의 계보(데모) 줄에 나오는 세계관들에도 장르 이름을 붙인다', async () => {
    const ref = (id: string, genre: string | null) => ({ id, name: id, genre, authorNickname: '작가', cardCount: 1 })
    const repo = server(0)
    repo.get.mockResolvedValueOnce({
      id: 'w', genre: 'genre-01', lineage: { derivedFrom: ref('o', 'genre-14'), combinedFrom: [ref('a', 'genre-03'), ref('b', null)], children: [{ ...ref('c', 'genre-99'), kind: 'derive' }] },
    } as PublicWorld)
    const { lineage } = (await new PublicWorldUseCase(repo, genres()).get('w'))!
    expect([lineage?.derivedFrom?.genreName, ...(lineage?.combinedFrom.map((r) => r.genreName) ?? []), ...(lineage?.children.map((r) => r.genreName) ?? [])]).toEqual(['SF', '무협', null, null])
    expect(lineage?.children[0]).toMatchObject({ id: 'c', kind: 'derive', genre: 'genre-99' })
  })

  it('장르 목록은 세계관 요청과 함께 읽고 취소 신호를 넘긴다', async () => {
    const list = vi.fn<GenreRepository['list']>(async () => [])
    const signal = new AbortController().signal
    const repo = server(1)
    const useCase = new PublicWorldUseCase(repo, { list })
    await useCase.list({}, signal)
    await useCase.searchWorlds({ q: '', page: 0 }, signal)
    await useCase.get('w1', signal)
    expect(list.mock.calls).toEqual([[signal], [signal], [signal]])
  })

  it('장르 목록을 읽지 못하면 이름 없는 일부 결과로 숨기지 않고 목록·검색·상세 모두 던진다', async () => {
    const down: GenreRepository = { list: async () => { throw new Error('genres offline') } }
    const useCase = new PublicWorldUseCase(server(1), down)
    await expect(useCase.list()).rejects.toThrow('genres offline')
    await expect(useCase.searchWorlds({ q: '', page: 0 })).rejects.toThrow('genres offline')
    await expect(useCase.get('w1')).rejects.toThrow('genres offline')
  })
})

import { describe, expect, it, vi } from 'vitest'

import type { PublicWorld, PublicWorldPage, PublicWorldSummary } from '../entities/publicWorld'
import type { PublicWorldQuery, PublicWorldRepository } from '../repositories/PublicWorldRepository'
import { PUBLIC_WORLD_MAX_PAGES, PUBLIC_WORLD_PAGE_SIZE, PublicWorldUseCase } from '../usecases/PublicWorldUseCase'

const summary = (n: number): PublicWorldSummary => ({
  id: `w${n}`, name: `세계관 ${n}`, description: '설명', genre: 'fantasy', authorNickname: '작가', cardCount: 3, relationshipCount: 1,
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
  return { list, get } satisfies PublicWorldRepository
}

describe('공개 세계관 목록', () => {
  it('한 쪽에 다 들어오면 첫 쪽만 요청하고 장르를 그대로 넘긴다', async () => {
    const repo = server(5)
    const page = await new PublicWorldUseCase(repo).list({ genre: 'sf' })
    expect(repo.list).toHaveBeenCalledTimes(1)
    expect(repo.list).toHaveBeenCalledWith({ genre: 'sf', page: 0, size: PUBLIC_WORLD_PAGE_SIZE }, undefined)
    expect(page.items.map((w) => w.id)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4'])
    expect(page.total).toBe(5)
  })

  it('장르를 안 주면 genre 쿼리 없이 전체를 요청한다', async () => {
    const repo = server(1)
    await new PublicWorldUseCase(repo).list()
    expect(Object.hasOwn(repo.list.mock.calls[0][0], 'genre')).toBe(false)
  })

  it('전체가 한 쪽을 넘으면 서버가 쓴 쪽 크기로 다음 쪽을 이어 붙여 최근 공개 순서를 지킨다', async () => {
    const repo = server(30)
    const { items, total } = await new PublicWorldUseCase(repo).list()
    expect(repo.list.mock.calls.map(([q]) => [q.page, q.size])).toEqual([[0, PUBLIC_WORLD_PAGE_SIZE], [1, PUBLIC_WORLD_PAGE_SIZE]])
    expect(items.map((w) => w.id)).toEqual(Array.from({ length: 30 }, (_, n) => `w${n}`))
    expect(total).toBe(30)
  })

  it('서버가 더 작은 쪽 크기를 쓰면 그 크기로 쪽을 나눠 요청해 빠지는 항목이 없다', async () => {
    const repo = server(25, 10)
    const { items } = await new PublicWorldUseCase(repo).list()
    expect(repo.list.mock.calls.map(([q]) => [q.page, q.size])).toEqual([[0, PUBLIC_WORLD_PAGE_SIZE], [1, 10], [2, 10]])
    expect(items).toHaveLength(25)
  })

  it(`최대 ${PUBLIC_WORLD_MAX_PAGES}쪽까지만 이어 붙이고 total은 서버가 센 전체 수를 그대로 둔다`, async () => {
    const repo = server(PUBLIC_WORLD_PAGE_SIZE * PUBLIC_WORLD_MAX_PAGES + 7)
    const { items, total } = await new PublicWorldUseCase(repo).list()
    expect(repo.list).toHaveBeenCalledTimes(PUBLIC_WORLD_MAX_PAGES)
    expect(items).toHaveLength(PUBLIC_WORLD_PAGE_SIZE * PUBLIC_WORLD_MAX_PAGES)
    expect(total).toBe(PUBLIC_WORLD_PAGE_SIZE * PUBLIC_WORLD_MAX_PAGES + 7)
  })

  it('중간 쪽이 비어 돌아오면(그 사이 목록이 줄어듦) 더 요청하지 않고 거기서 멈춘다', async () => {
    const repo = { list: vi.fn(async ({ page }: PublicWorldQuery): Promise<PublicWorldPage> => ({ items: page === 0 ? [summary(0)] : [], page, size: 1, total: 99 })), get: vi.fn() } satisfies PublicWorldRepository
    const { items } = await new PublicWorldUseCase(repo).list()
    expect(repo.list).toHaveBeenCalledTimes(2)
    expect(items.map((w) => w.id)).toEqual(['w0'])
  })

  it('쪽을 읽는 사이 목록이 밀려 같은 세계관이 두 쪽에 나오면 처음 나온 하나만 남긴다', async () => {
    const pages = [[summary(0), summary(1)], [summary(1), summary(2)]]
    const repo = { list: vi.fn(async ({ page }: PublicWorldQuery): Promise<PublicWorldPage> => ({ items: pages[page] ?? [], page, size: 2, total: 4 })), get: vi.fn() } satisfies PublicWorldRepository
    const { items } = await new PublicWorldUseCase(repo).list()
    expect(items.map((w) => w.id)).toEqual(['w0', 'w1', 'w2'])
  })

  it('취소 신호를 모든 쪽 요청에 넘기고 한 쪽이라도 실패하면 일부 결과로 숨기지 않고 던진다', async () => {
    const signal = new AbortController().signal
    const repo = server(30)
    await new PublicWorldUseCase(repo).list({}, signal)
    expect(repo.list.mock.calls.map(([, s]) => s)).toEqual([signal, signal])
    repo.list.mockImplementationOnce(async (q) => ({ items: [summary(0)], page: q.page, size: 1, total: 2 })).mockRejectedValueOnce(new Error('offline'))
    await expect(new PublicWorldUseCase(repo).list()).rejects.toThrow('offline')
  })
})

describe('공개 세계관 상세', () => {
  it('저장소 결과를 그대로 돌려주고 비공개·없는 세계관(undefined)도 그대로 알린다', async () => {
    const world = { id: 'w1' } as PublicWorld
    const repo = { list: vi.fn(), get: vi.fn(async (id: string) => (id === 'w1' ? world : undefined)) } satisfies PublicWorldRepository
    const signal = new AbortController().signal
    const useCase = new PublicWorldUseCase(repo)
    expect(await useCase.get('w1', signal)).toBe(world)
    expect(repo.get).toHaveBeenCalledWith('w1', signal)
    expect(await useCase.get('없음')).toBeUndefined()
  })
})

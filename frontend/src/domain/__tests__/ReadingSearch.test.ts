import { describe, expect, it, vi } from 'vitest'

import { seedWorks, seedWorlds } from '../../data/mock/seed'
import type { Episode as ContentEpisode } from '../entities/content'
import type { Work } from '../entities/work'
import type { ReadingRecordRepository } from '../repositories/ReadingRecordRepository'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import type { WorkRankingQuery, WorkSearchRepository } from '../repositories/WorkSearchRepository'
import { ReadingUseCase } from '../usecases/ReadingUseCase'

/** 서버가 돌려주는 카드용 Work(메모리 시드와 id가 겹치지 않는다) */
const serverWork = (id: string, over: Partial<Work> = {}): Work => ({ ...seedWorks(0)[0], id, title: `서버 ${id}`, views: 10, parent: undefined, forkAt: undefined, ...over })
/** 서버 기간별 랭킹 응답: 순위 목록과 계산 시각 */
const at = new Date('2026-11-10T05:07:00Z')
const ranked = (items: Work[] = [], computedAt = at) => ({ items, computedAt })

function setup(search?: Partial<WorkSearchRepository>, works = seedWorks(0)) {
  const state: ReadingProgress = { last: {}, read: {}, seen: {}, liked: {} }
  const workRepository: WorkRepository = { listWorks: async () => works, listWorlds: async () => seedWorlds(), readWorld: async (work) => work, createFork: async () => ({ id: 'forked' }), saveWork: async () => {}, getDraft: async () => undefined, listDrafts: async () => ({}), saveDraft: async () => {}, deleteDraft: async () => {} }
  const readingRepository: ReadingRepository = { getProgress: async () => state, markSeen: async () => {}, saveProgress: async () => {} }
  const readingRecordRepository: ReadingRecordRepository = { list: async () => [], record: async () => {}, remove: async () => {} }
  const repo: WorkSearchRepository | undefined = search && { search: vi.fn(async () => []), rankings: vi.fn(async () => ranked()), recordView: vi.fn(async () => {}), ...search }
  return { useCase: new ReadingUseCase(workRepository, readingRepository, readingRecordRepository, repo) }
}

describe('ReadingUseCase.getHome 서버 랭킹', () => {
  it('실시간 인기와 급상승을 서버 랭킹으로 채우고 나머지 섹션은 그대로 둔다', async () => {
    const top = [serverWork('t1'), serverWork('t2')]
    const rising = [serverWork('r1')]
    const rankings = vi.fn(async ({ kind }: WorkRankingQuery) => ranked(kind === 'view' ? top : kind === 'rising' ? rising : []))
    const home = await setup({ rankings }).useCase.getHome(null, '추천')
    expect(home.top10).toEqual(top)
    expect(home.rising).toEqual(rising)
    expect(home.rankingFailed).toBe(false)
    expect(rankings.mock.calls.map(([query]) => query.kind).sort()).toEqual(['latest', 'popular', 'rising', 'updated', 'view'])
    expect(home.originals.map((w) => w.id)).toEqual(['guunmong', 'starlight', 'postman', 'hong'])
  })

  it('홈의 다섯 줄을 계약의 기준·기간·범위로 서버에 묻는다', async () => {
    const rankings = vi.fn(async (_query: WorkRankingQuery) => ranked())
    await setup({ rankings }).useCase.getHome(null, '추천')
    const asked = rankings.mock.calls.map(([query]) => query)
    expect(asked).toHaveLength(5)
    expect(asked).toEqual(expect.arrayContaining([
      { kind: 'view', period: 'day' }, { kind: 'rising', period: 'day' }, { kind: 'latest', type: 'fork' },
      { kind: 'updated', limit: 5 }, { kind: 'popular', period: 'week', limit: 4 },
    ]))
  })

  it('포크 소설 줄·방금 업데이트·이번 주 인기 무료 소설은 서버 결과를 쓰고 TOP10의 계산 시각을 알린다', async () => {
    const lists: Record<string, Work[]> = { view: [serverWork('v')], rising: [serverWork('r')], latest: [serverWork('f', { parent: 'v', forkAt: 1 })], updated: [serverWork('u')], popular: [serverWork('p')] }
    const rankings = vi.fn(async ({ kind }: WorkRankingQuery) => ranked(lists[kind], kind === 'view' ? at : new Date(0)))
    const home = await setup({ rankings }).useCase.getHome(null, '추천')
    expect([home.top10, home.rising, home.forkFeed, home.fresh, home.weekly].map((list) => list.map((w) => w.id))).toEqual([['v'], ['r'], ['f'], ['u'], ['p']])
    expect(home.rankingComputedAt).toEqual(at)
    expect(home.serverRanking).toBe(true)
  })

  it('서버가 빈 랭킹을 주면 빈 목록 그대로 둔다(실패가 아니다)', async () => {
    const home = await setup({ rankings: async () => ranked() }).useCase.getHome(null, '추천')
    expect(home.top10).toEqual([])
    expect(home.rising).toEqual([])
    expect(home.rankingFailed).toBe(false)
    // 메모리 목록으로 채우지 않는다.
    expect([home.forkFeed, home.fresh, home.weekly]).toEqual([[], [], []])
    expect([home.forkFeedFailed, home.freshFailed, home.weeklyFailed]).toEqual([false, false, false])
  })

  it('랭킹 조회가 실패하면 홈 전체를 막지 않고 rankingFailed로 알린다', async () => {
    const home = await setup({ rankings: async () => { throw new Error('offline') } }).useCase.getHome(null, '추천')
    expect(home.rankingFailed).toBe(true)
    expect(home.top10).toEqual([])
    expect(home.rising).toEqual([])
    expect(home.originals).toHaveLength(4)
    expect(home.rankingComputedAt).toBeNull()
    expect([home.forkFeedFailed, home.freshFailed, home.weeklyFailed]).toEqual([true, true, true])
  })

  it.each([['view', 'rankingFailed'], ['rising', 'rankingFailed'], ['latest', 'forkFeedFailed'], ['updated', 'freshFailed'], ['popular', 'weeklyFailed']] as const)(
    '%s 한 줄만 실패하면 %s만 알리고 그 줄을 메모리로 채우지 않으며 나머지는 서버 결과를 쓴다', async (failing, flag) => {
      const rankings = vi.fn(async ({ kind }: WorkRankingQuery) => { if (kind === failing) throw new Error('offline'); return ranked([serverWork(kind)]) })
      const home = await setup({ rankings }).useCase.getHome(null, '추천')
      const flags = { rankingFailed: home.rankingFailed, forkFeedFailed: home.forkFeedFailed, freshFailed: home.freshFailed, weeklyFailed: home.weeklyFailed }
      expect(flags).toEqual({ rankingFailed: false, forkFeedFailed: false, freshFailed: false, weeklyFailed: false, [flag]: true })
      const lines = { view: home.top10, rising: home.rising, latest: home.forkFeed, updated: home.fresh, popular: home.weekly }
      expect(Object.entries(lines).map(([kind, list]) => [kind, list.map((w) => w.id)])).toEqual(
        Object.keys(lines).map((kind) => [kind, kind === failing ? [] : [kind]]))
    })

  it.each(['view', 'rising'] as const)('%s 줄이 실패하면 다른 줄이 성공해도 TOP10 머리의 계산 시각을 알리지 않는다(rankingFailed면 rankingComputedAt은 null)', async (failing) => {
    const rankings = vi.fn(async ({ kind }: WorkRankingQuery) => { if (kind === failing) throw new Error('offline'); return ranked([serverWork(kind)]) })
    const home = await setup({ rankings }).useCase.getHome(null, '추천')
    expect(home.rankingFailed).toBe(true)
    expect(home.rankingComputedAt).toBeNull()
  })

  it('순위 섹션이 실제 순위인지(ranked) 알린다: 서버 랭킹(실패 포함)과 지표가 있는 목업은 true, 지표 없는 서버 작품의 메모리 목록은 false', async () => {
    const placeholder = seedWorks(0).map((w) => ({ ...w, canonical: true, statisticsSupported: false }))
    expect((await setup({ rankings: async () => ranked([serverWork('t1', { statisticsSupported: false })]) }, placeholder).useCase.getHome(null, '추천')).ranked).toBe(true)
    expect((await setup({ rankings: async () => { throw new Error('offline') } }, placeholder).useCase.getHome(null, '추천')).ranked).toBe(true)
    expect((await setup().useCase.getHome(null, '추천')).ranked).toBe(true)
    expect((await setup(undefined, placeholder).useCase.getHome(null, '추천')).ranked).toBe(false)
  })

  it('저장소를 주입하지 않은 목업은 기존 메모리 순위를 유지한다', async () => {
    const home = await setup().useCase.getHome(null, '추천')
    expect(home.top10[0].id).toBe('guunmong')
    expect(home.rising.map((w) => w.id)).toEqual(['guunmong', 'postman', 'hong', 'starlight'])
    expect(home.rankingFailed).toBe(false)
  })

  it('목업의 포크 소설 줄·방금 업데이트·원작 소개는 메모리 정렬이고 실패 플래그·계산 시각이 없다', async () => {
    const home = await setup().useCase.getHome(null, '추천')
    expect(home.forkFeed.map((w) => w.id)).toEqual(['gate', 'crown', 'postif', 'cloud', 'seal', 'pardon', 'reply'])
    expect(home.fresh.map((w) => w.id)).toEqual(['gate', 'crown', 'postif', 'cloud', 'starlight'])
    expect(home.weekly.map((w) => w.id)).toEqual(['guunmong', 'starlight', 'postman', 'hong'])
    expect(home).toMatchObject({ forkFeedFailed: false, freshFailed: false, weeklyFailed: false, rankingComputedAt: null, serverRanking: false })
  })

  it('무료 칩은 서버(canonical) 작품도 무료로 보이고, 목업은 free 태그 작품만 보인다', async () => {
    const works = seedWorks(0).map((w) => (['starlight', 'cloud'].includes(w.id) ? { ...w, canonical: true } : w))
    expect((await setup(undefined, works).useCase.getHome(null, '🆓 무료')).filtered!.map((w) => w.id)).toEqual(['guunmong', 'starlight', 'hong', 'cloud'])
    expect((await setup().useCase.getHome(null, '🆓 무료')).filtered!.map((w) => w.id)).toEqual(['guunmong', 'hong'])
  })
})

describe('ReadingUseCase.rankWorks 랭킹 화면', () => {
  it('서버 저장소가 있으면 범위 탭을 서버 범위로 바꿔 최대 50개를 묻고 응답을 그대로 돌려준다', async () => {
    const found = ranked([serverWork('a')])
    const rankings = vi.fn(async (_query: WorkRankingQuery) => found)
    const { useCase } = setup({ rankings })
    expect(await useCase.rankWorks({ t: 'all', kind: 'view', period: 'week' })).toBe(found)
    await useCase.rankWorks({ t: 'orig', kind: 'popular', period: 'month' })
    await useCase.rankWorks({ t: 'if', kind: 'rising', period: 'day' })
    await useCase.rankWorks({ kind: 'view', period: 'day' })
    expect(rankings.mock.calls.map(([query]) => query)).toEqual([
      { kind: 'view', period: 'week', type: 'all', limit: 50 },
      { kind: 'popular', period: 'month', type: 'original', limit: 50 },
      { kind: 'rising', period: 'day', type: 'fork', limit: 50 },
      { kind: 'view', period: 'day', type: 'all', limit: 50 },
    ])
  })

  it('최신·방금 업데이트는 기간을 쓰지 않으므로 기간을 보내지 않는다', async () => {
    const rankings = vi.fn(async (_query: WorkRankingQuery) => ranked())
    const { useCase } = setup({ rankings })
    await useCase.rankWorks({ t: 'all', kind: 'latest', period: 'month' })
    await useCase.rankWorks({ t: 'if', kind: 'updated', period: 'week' })
    expect(rankings.mock.calls.map(([query]) => query)).toEqual([
      { kind: 'latest', type: 'all', limit: 50 }, { kind: 'updated', type: 'fork', limit: 50 },
    ])
  })

  it('서버 실패는 빈 목록으로 숨기지 않고 오류로 알린다', async () => {
    const { useCase } = setup({ rankings: async () => { throw new Error('offline') } })
    await expect(useCase.rankWorks({ t: 'all', kind: 'view', period: 'day' })).rejects.toThrow('offline')
  })

  it('목업은 기간 없이 메모리 정렬로 답하고 서버 계산 시각이 없다', async () => {
    const { useCase } = setup()
    const ids = async (query: Parameters<typeof useCase.rankWorks>[0]) => (await useCase.rankWorks(query)).items.map((w) => w.id)
    expect(await ids({ t: 'orig', kind: 'view', period: 'day' })).toEqual(['guunmong', 'postman', 'hong', 'starlight'])
    expect(await ids({ t: 'orig', kind: 'rising', period: 'week' })).toEqual(['guunmong', 'postman', 'hong', 'starlight'])
    expect(await ids({ t: 'orig', kind: 'popular', period: 'day' })).toEqual(['guunmong', 'postman', 'hong', 'starlight'])
    expect(await ids({ t: 'orig', kind: 'latest', period: 'day' })).toEqual(['starlight', 'guunmong', 'postman', 'hong'])
    expect(await ids({ t: 'if', kind: 'updated', period: 'day' })).toEqual(['gate', 'crown', 'postif', 'cloud', 'seal', 'pardon', 'reply'])
    expect(await ids({ t: 'if', kind: 'view', period: 'day' })).toEqual(['cloud', 'gate', 'seal', 'pardon', 'crown', 'postif', 'reply'])
    expect(await ids({ kind: 'view', period: 'day' })).toHaveLength(11)
    expect((await useCase.rankWorks({ t: 'all', kind: 'view', period: 'day' })).computedAt).toBeNull()
  })
})

describe('ReadingUseCase.findWorks 서버 검색', () => {
  const works = (count: number, over: Partial<Work> = {}) => Array.from({ length: count }, (_, i) => serverWork(`w${i}`, over))

  it('검색어의 앞뒤 공백을 지우고 범위·정렬·첫 서버 페이지(page 0, size 20)와 함께 보내 결과를 돌려준다', async () => {
    const found = [serverWork('a'), serverWork('b')]
    const search = vi.fn(async () => found)
    const page = await setup({ search }).useCase.findWorks({ q: ' 별빛 ', f: 'genre', sort: 'view' })
    expect(search).toHaveBeenCalledWith({ q: '별빛', f: 'genre', sort: 'view', page: 0, size: 20 }, undefined)
    expect(page).toEqual({ list: found, hasMore: false })
  })

  it('page는 서버 페이지 번호로, 취소 신호는 서버 검색에 그대로 넘긴다', async () => {
    const search = vi.fn(async () => [])
    const { signal } = new AbortController()
    await setup({ search }).useCase.findWorks({ sort: 'like', page: 2 }, signal)
    expect(search).toHaveBeenCalledWith({ q: '', f: 'all', sort: 'like', page: 2, size: 20 }, signal)
  })

  it('서버가 20개를 가득 채워 주면 더 있을 수 있어 hasMore이고, 그보다 적으면 마지막 페이지다', async () => {
    const hasMore = async (count: number) => (await setup({ search: async () => works(count) }).useCase.findWorks({ sort: 'latest' })).hasMore
    expect(await hasMore(20)).toBe(true)
    expect(await hasMore(19)).toBe(false)
    expect(await hasMore(0)).toBe(false)
  })

  it('페이지를 무시하고 전부 돌려주는 서버(21개 이상)는 마지막 페이지로 본다 — 같은 목록을 이어 붙이지 않는다', async () => {
    expect((await setup({ search: async () => works(21) }).useCase.findWorks({ sort: 'latest' })).hasMore).toBe(false)
  })

  it('서버 실패는 빈 목록으로 숨기지 않고 오류로 알린다', async () => {
    const { useCase } = setup({ search: async () => { throw new Error('offline') } })
    await expect(useCase.findWorks({ sort: 'latest' })).rejects.toThrow('offline')
  })
})

describe('ReadingUseCase.findWorks 메모리(목업)', () => {
  it('최신 순(latest)은 목업의 새 순과 같고 전부 보여 주므로 더 보기가 없다', async () => {
    const page = await setup().useCase.findWorks({ q: '회색', sort: 'latest' })
    expect(page.list.map((w) => w.id)).toEqual(['postif', 'reply', 'postman'])
    expect(page.hasMore).toBe(false)
  })

  it('인기 순(like)은 목업의 좋아요 수 순이고 조회 순과 따로 정렬한다', async () => {
    const [base] = seedWorks(0)
    const works = [{ ...base, id: 'quiet', likes: 900, views: 10 }, { ...base, id: 'seen', likes: 5, views: 5000 }, { ...base, id: 'mid', likes: 300, views: 300 }]
    const { useCase } = setup(undefined, works)
    expect((await useCase.findWorks({ sort: 'like' })).list.map((w) => w.id)).toEqual(['quiet', 'mid', 'seen'])
    expect((await useCase.findWorks({ sort: 'view' })).list.map((w) => w.id)).toEqual(['seen', 'mid', 'quiet'])
  })

  it('장르 범위는 장르를 검색하고 전체 범위는 기존처럼 장르를 보지 않는다', async () => {
    const { useCase } = setup()
    expect((await useCase.findWorks({ q: '판타지', f: 'genre', sort: 'view' })).list.map((w) => w.id))
      .toEqual(['guunmong', 'starlight', 'cloud', 'gate', 'seal', 'pardon', 'crown'])
    expect((await useCase.findWorks({ q: '판타지', f: 'all', sort: 'view' })).list).toEqual([])
  })
})

describe('ReadingUseCase.recordViews 공개 열람 기록', () => {
  const episode = (number: number, inherited = false): ContentEpisode => ({ number, version: 1, title: `${number}화`, body: '', inherited })

  it('한 화면에 전체 회차가 보이므로 상속이 아닌 첫 발행 회차 1건만 기록한다(상속 회차는 원작 몫)', async () => {
    const recordView = vi.fn(async () => {})
    await setup({ recordView }).useCase.recordViews({ id: 'f1', readOnly: true, episodes: [episode(1, true), episode(2), episode(3)] })
    expect(recordView.mock.calls).toEqual([['f1', 2]])
  })

  it('공개 열람 화면이 아닌 작품, 저장소가 없는 목업, 기록할 자체 회차가 없는 작품은 기록하지 않는다', async () => {
    const recordView = vi.fn(async () => {})
    await setup({ recordView }).useCase.recordViews({ id: 'mine', episodes: [episode(1)] })
    await setup().useCase.recordViews({ id: 'w', readOnly: true, episodes: [episode(1)] })
    await setup({ recordView }).useCase.recordViews({ id: 'inherited', readOnly: true, episodes: [episode(1, true), episode(2, true)] })
    await setup({ recordView }).useCase.recordViews({ id: 'empty', readOnly: true, episodes: [] })
    expect(recordView).not.toHaveBeenCalled()
  })

  it('기록이 실패해도 읽기를 막지 않고 다른 회차로 다시 보내지도 않는다', async () => {
    const recordView = vi.fn(async () => { throw new Error('offline') })
    const { useCase } = setup({ recordView })
    await expect(useCase.recordViews({ id: 'w', readOnly: true, episodes: [episode(1), episode(2)] })).resolves.toBeUndefined()
    expect(recordView).toHaveBeenCalledTimes(1)
  })
})

describe('ReadingUseCase.openEpisode 회차 열람 조회 기록', () => {
  const server = () => seedWorks(0).map((w) => ({ ...w, canonical: true }))

  it('로그인 회원이 서버 작품의 회차를 열면 그 회차 번호로 기록한다', async () => {
    const recordView = vi.fn(async () => {})
    const result = await setup({ recordView }, server()).useCase.openEpisode('guunmong', 2, 'user')
    expect(result).toMatchObject({ n: 2 })
    expect(recordView.mock.calls).toEqual([['guunmong', 2]])
  })

  it('Fork는 상속분이 아닌 자체 회차만 이어진 번호로 기록한다(상속 회차는 원작 몫)', async () => {
    const recordView = vi.fn(async () => {})
    const { useCase } = setup({ recordView }, server())
    await useCase.openEpisode('cloud', 1, 'user')
    await useCase.openEpisode('cloud', 2, 'user')
    expect(recordView).not.toHaveBeenCalled()
    await useCase.openEpisode('cloud', 3, 'user')
    expect(recordView.mock.calls).toEqual([['cloud', 3]])
  })

  it('익명·메모리 데모 작품·검색 저장소가 없는 목업은 요청하지 않는다', async () => {
    const recordView = vi.fn(async () => {})
    await setup({ recordView }, server()).useCase.openEpisode('guunmong', 2, null)
    await setup({ recordView }).useCase.openEpisode('guunmong', 2, 'user')
    await expect(setup(undefined, server()).useCase.openEpisode('guunmong', 2, 'user')).resolves.toMatchObject({ n: 2 })
    expect(recordView).not.toHaveBeenCalled()
  })

  it('소유자가 연 비공개 작품은 서버가 404로 거절하므로 요청하지 않는다(공개로 바꾸면 기록한다)', async () => {
    const recordView = vi.fn(async () => {})
    const works = server()
    const mine = works.find((w) => w.id === 'starlight')!
    mine.private = true
    const { useCase } = setup({ recordView }, works)
    await expect(useCase.openEpisode('starlight', 2, 'user')).resolves.toMatchObject({ n: 2 })
    expect(recordView).not.toHaveBeenCalled()
    mine.private = false
    await useCase.openEpisode('starlight', 2, 'user')
    expect(recordView.mock.calls).toEqual([['starlight', 2]])
  })

  it('숨긴 회차와 볼 수 없는 작품은 기록하지 않는다', async () => {
    const recordView = vi.fn(async () => {})
    const works = server()
    works.find((w) => w.id === 'postman')!.eps[0].hidden = true
    const { useCase } = setup({ recordView }, works)
    expect(await useCase.openEpisode('postman', 1, 'user')).toBe('hidden')
    expect(await useCase.openEpisode('nope', 1, 'user')).toBeNull()
    expect(recordView).not.toHaveBeenCalled()
  })

  it('기록이 실패해도 읽기를 막지 않는다', async () => {
    const recordView = vi.fn(async () => { throw new Error('offline') })
    const result = await setup({ recordView }, server()).useCase.openEpisode('guunmong', 3, 'user')
    expect(result).toMatchObject({ n: 3 })
    expect(recordView).toHaveBeenCalledTimes(1)
  })
})

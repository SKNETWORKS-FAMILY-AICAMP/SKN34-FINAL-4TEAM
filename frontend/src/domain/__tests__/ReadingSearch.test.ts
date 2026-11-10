import { describe, expect, it, vi } from 'vitest'

import { seedWorks, seedWorlds } from '../../data/mock/seed'
import type { Episode as ContentEpisode } from '../entities/content'
import type { Work } from '../entities/work'
import type { ReadingRecordRepository } from '../repositories/ReadingRecordRepository'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import type { WorkSearchRepository } from '../repositories/WorkSearchRepository'
import { ReadingUseCase } from '../usecases/ReadingUseCase'

/** 서버가 돌려주는 카드용 Work(메모리 시드와 id가 겹치지 않는다) */
const serverWork = (id: string, over: Partial<Work> = {}): Work => ({ ...seedWorks(0)[0], id, title: `서버 ${id}`, views: 10, parent: undefined, forkAt: undefined, ...over })

function setup(search?: Partial<WorkSearchRepository>, works = seedWorks(0)) {
  const state: ReadingProgress = { last: {}, read: {}, seen: {}, liked: {} }
  const workRepository: WorkRepository = { listWorks: async () => works, listWorlds: async () => seedWorlds(), readWorld: async (work) => work, createFork: async () => ({ id: 'forked' }), saveWork: async () => {}, getDraft: async () => undefined, listDrafts: async () => ({}), saveDraft: async () => {}, deleteDraft: async () => {} }
  const readingRepository: ReadingRepository = { getProgress: async () => state, markSeen: async () => {}, saveProgress: async () => {} }
  const readingRecordRepository: ReadingRecordRepository = { list: async () => [], record: async () => {}, remove: async () => {} }
  const repo: WorkSearchRepository | undefined = search && { search: vi.fn(async () => []), ranking: vi.fn(async () => []), recordView: vi.fn(async () => {}), ...search }
  return { useCase: new ReadingUseCase(workRepository, readingRepository, readingRecordRepository, repo) }
}

describe('ReadingUseCase.getHome 서버 랭킹', () => {
  it('실시간 인기와 급상승을 서버 랭킹으로 채우고 나머지 섹션은 그대로 둔다', async () => {
    const top = [serverWork('t1'), serverWork('t2')]
    const rising = [serverWork('r1')]
    const ranking = vi.fn(async (kind: 'top' | 'rising') => (kind === 'top' ? top : rising))
    const home = await setup({ ranking }).useCase.getHome(null, '추천')
    expect(home.top10).toEqual(top)
    expect(home.rising).toEqual(rising)
    expect(home.rankingFailed).toBe(false)
    expect(ranking.mock.calls.map(([kind]) => kind).sort()).toEqual(['rising', 'top'])
    expect(home.originals.map((w) => w.id)).toEqual(['guunmong', 'starlight', 'postman', 'hong'])
  })

  it('서버가 빈 랭킹을 주면 빈 목록 그대로 둔다(실패가 아니다)', async () => {
    const home = await setup({ ranking: async () => [] }).useCase.getHome(null, '추천')
    expect(home.top10).toEqual([])
    expect(home.rising).toEqual([])
    expect(home.rankingFailed).toBe(false)
  })

  it('랭킹 조회가 실패하면 홈 전체를 막지 않고 rankingFailed로 알린다', async () => {
    const home = await setup({ ranking: async () => { throw new Error('offline') } }).useCase.getHome(null, '추천')
    expect(home.rankingFailed).toBe(true)
    expect(home.top10).toEqual([])
    expect(home.rising).toEqual([])
    expect(home.originals).toHaveLength(4)
  })

  it('순위 섹션이 실제 순위인지(ranked) 알린다: 서버 랭킹(실패 포함)과 지표가 있는 목업은 true, 지표 없는 서버 작품의 메모리 목록은 false', async () => {
    const placeholder = seedWorks(0).map((w) => ({ ...w, canonical: true, statisticsSupported: false }))
    expect((await setup({ ranking: async () => [serverWork('t1', { statisticsSupported: false })] }, placeholder).useCase.getHome(null, '추천')).ranked).toBe(true)
    expect((await setup({ ranking: async () => { throw new Error('offline') } }, placeholder).useCase.getHome(null, '추천')).ranked).toBe(true)
    expect((await setup().useCase.getHome(null, '추천')).ranked).toBe(true)
    expect((await setup(undefined, placeholder).useCase.getHome(null, '추천')).ranked).toBe(false)
  })

  it('저장소를 주입하지 않은 목업은 기존 메모리 순위를 유지한다', async () => {
    const home = await setup().useCase.getHome(null, '추천')
    expect(home.top10[0].id).toBe('guunmong')
    expect(home.rising.map((w) => w.id)).toEqual(['guunmong', 'postman', 'hong', 'starlight'])
    expect(home.rankingFailed).toBe(false)
  })
})

describe('ReadingUseCase.getHome 장르 칩·오늘의 발견', () => {
  it('장르 칩은 서버 검색을 장르 범위·좋아요순으로 불러 결과를 그대로 보여 준다', async () => {
    const found = [serverWork('g1'), serverWork('g2')]
    const search = vi.fn(async () => found)
    const home = await setup({ search }).useCase.getHome(null, '✨ 판타지')
    expect(search).toHaveBeenCalledWith({ q: '판타지', f: 'genre', sort: 'like' })
    expect(home.filtered).toEqual(found)
  })

  it('고전 칩도 서버 장르 검색(고전)으로 부른다', async () => {
    const search = vi.fn(async () => [])
    await setup({ search }).useCase.getHome(null, '📜 고전')
    expect(search).toHaveBeenCalledWith({ q: '고전', f: 'genre', sort: 'like' })
  })

  it('장르 검색이 실패하면 빈 결과로 숨기지 않고 던진다', async () => {
    await expect(setup({ search: async () => { throw new Error('offline') } }).useCase.getHome(null, '🛰 SF')).rejects.toThrow('offline')
  })

  it('추천 화면은 서버 검색을 부르지 않는다', async () => {
    const search = vi.fn(async () => [])
    await setup({ search }).useCase.getHome(null, '추천')
    expect(search).not.toHaveBeenCalled()
  })

  it('오늘의 발견은 서버 공개 목록(생성 최신순)을 뒤집은 오래된 순이다', async () => {
    const list = [serverWork('new', { statisticsSupported: false, upd: 0 }), serverWork('mid', { statisticsSupported: false, upd: 0 }), serverWork('old', { statisticsSupported: false, upd: 0 })]
    const home = await setup({}, list).useCase.getHome(null, '추천')
    expect(home.discover.map((w) => w.id)).toEqual(['old', 'mid', 'new'])
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

  it('랭킹 탭 t=orig·if는 서버 결과에서 원작·Fork로 거른다', async () => {
    const found = [serverWork('o1'), serverWork('f1', { parent: 'o1', forkAt: 2 }), serverWork('o2')]
    const { useCase } = setup({ search: async () => found })
    expect((await useCase.findWorks({ t: 'orig', sort: 'view' })).list.map((w) => w.id)).toEqual(['o1', 'o2'])
    expect((await useCase.findWorks({ t: 'if', sort: 'view' })).list.map((w) => w.id)).toEqual(['f1'])
    expect((await useCase.findWorks({ t: 'all', sort: 'view' })).list.map((w) => w.id)).toEqual(['o1', 'f1', 'o2'])
  })

  it('더 보기 여부는 탭으로 거르기 전 서버 개수로 정한다 — 한 페이지가 전부 Fork여도 원작 탭의 다음 페이지가 있을 수 있다', async () => {
    const { useCase } = setup({ search: async () => works(20, { parent: 'o1', forkAt: 2 }) })
    expect(await useCase.findWorks({ t: 'orig', sort: 'view' })).toEqual({ list: [], hasMore: true })
    expect((await useCase.findWorks({ t: 'if', sort: 'view' })).list).toHaveLength(20)
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

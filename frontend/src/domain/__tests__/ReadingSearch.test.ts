import { describe, expect, it, vi } from 'vitest'

import { seedWorks, seedWorlds } from '../../data/mock/seed'
import type { Episode as ContentEpisode } from '../entities/content'
import type { Work } from '../entities/work'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import type { WorkSearchRepository } from '../repositories/WorkSearchRepository'
import { ReadingUseCase } from '../usecases/ReadingUseCase'

/** 서버가 돌려주는 카드용 Work(메모리 시드와 id가 겹치지 않는다) */
const serverWork = (id: string, over: Partial<Work> = {}): Work => ({ ...seedWorks(0)[0], id, title: `서버 ${id}`, views: 10, parent: undefined, forkAt: undefined, ...over })

function setup(search?: Partial<WorkSearchRepository>, works = seedWorks(0)) {
  const state: ReadingProgress = { last: {}, read: {}, seen: {}, liked: {} }
  const workRepository: WorkRepository = { listWorks: async () => works, listWorlds: async () => seedWorlds(), readWorld: async (work) => work, createFork: async () => ({ id: 'forked' }), saveWork: async () => {}, getDraft: async () => undefined, listDrafts: async () => ({}), saveDraft: async () => {}, deleteDraft: async () => {} }
  const readingRepository: ReadingRepository = { getProgress: async () => state, markSeen: async () => {}, saveProgress: async () => {} }
  const repo: WorkSearchRepository | undefined = search && { search: vi.fn(async () => []), ranking: vi.fn(async () => []), recordView: vi.fn(async () => {}), ...search }
  return { useCase: new ReadingUseCase(workRepository, readingRepository, repo) }
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

describe('ReadingUseCase.findWorks 서버 검색', () => {
  it('검색어의 앞뒤 공백을 지우고 범위·정렬과 함께 서버에 보낸 결과를 그대로 돌려준다', async () => {
    const found = [serverWork('a'), serverWork('b')]
    const search = vi.fn(async () => found)
    const list = await setup({ search }).useCase.findWorks({ q: ' 별빛 ', f: 'genre', sort: 'view' })
    expect(search).toHaveBeenCalledWith({ q: '별빛', f: 'genre', sort: 'view' })
    expect(list).toEqual(found)
  })

  it('랭킹 탭 t=orig·if는 서버 결과에서 원작·Fork로 거른다', async () => {
    const found = [serverWork('o1'), serverWork('f1', { parent: 'o1', forkAt: 2 }), serverWork('o2')]
    const { useCase } = setup({ search: async () => found })
    expect((await useCase.findWorks({ t: 'orig', sort: 'view' })).map((w) => w.id)).toEqual(['o1', 'o2'])
    expect((await useCase.findWorks({ t: 'if', sort: 'view' })).map((w) => w.id)).toEqual(['f1'])
    expect((await useCase.findWorks({ t: 'all', sort: 'view' })).map((w) => w.id)).toEqual(['o1', 'f1', 'o2'])
  })

  it('서버 실패는 빈 목록으로 숨기지 않고 오류로 알린다', async () => {
    const { useCase } = setup({ search: async () => { throw new Error('offline') } })
    await expect(useCase.findWorks({ sort: 'latest' })).rejects.toThrow('offline')
  })
})

describe('ReadingUseCase.findWorks 메모리(목업)', () => {
  it('최신 순(latest)은 목업의 새 순과 같다', async () => {
    const list = await setup().useCase.findWorks({ q: '회색', sort: 'latest' })
    expect(list.map((w) => w.id)).toEqual(['postif', 'reply', 'postman'])
  })

  it('장르 범위는 장르를 검색하고 전체 범위는 기존처럼 장르를 보지 않는다', async () => {
    const { useCase } = setup()
    expect((await useCase.findWorks({ q: '판타지', f: 'genre', sort: 'view' })).map((w) => w.id))
      .toEqual(['guunmong', 'starlight', 'cloud', 'gate', 'seal', 'pardon', 'crown'])
    expect(await useCase.findWorks({ q: '판타지', f: 'all', sort: 'view' })).toEqual([])
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

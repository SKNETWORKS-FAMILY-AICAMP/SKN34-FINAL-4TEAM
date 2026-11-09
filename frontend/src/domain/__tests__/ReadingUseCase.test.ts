import { describe, expect, it, vi } from 'vitest'

import { seedWorks, seedWorlds } from '../../data/mock/seed'
import type { ReadingRecord, ReadingRecordRepository } from '../repositories/ReadingRecordRepository'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import { ReadingUseCase } from '../usecases/ReadingUseCase'

/** 서버 독서 기록 대역: 계약대로 위치를 그 회차로 옮기고 읽은 회차에 더하며 작품을 맨 앞으로 올립니다. */
function recordFake(seed: ReadingRecord[]) {
  let records = seed.map((r) => ({ ...r, readEpisodes: [...r.readEpisodes] }))
  const repository: ReadingRecordRepository = {
    list: vi.fn(async () => records.map((r) => ({ ...r, readEpisodes: [...r.readEpisodes] }))),
    record: vi.fn(async (workId: string, episode: number) => {
      const read = new Set(records.find((r) => r.workId === workId)?.readEpisodes).add(episode)
      records = [{ workId, lastEpisode: episode, readEpisodes: [...read].sort((a, b) => a - b) }, ...records.filter((r) => r.workId !== workId)]
    }),
    remove: vi.fn(async () => {}),
  }
  return { repository, current: () => records }
}

function fakes(progress: Partial<ReadingProgress> = {}) {
  const works = seedWorks(0)
  const state: ReadingProgress = { last: {}, read: {}, seen: {}, liked: {}, ...progress }
  const server = recordFake([{ workId: 'guunmong', lastEpisode: 2, readEpisodes: [1, 2] }, { workId: 'starlight', lastEpisode: 1, readEpisodes: [1] }])
  const workRepository: WorkRepository = { listWorks: async () => works, listWorlds: async () => seedWorlds(), readWorld: async w => w, createFork: async () => { throw new Error('not used') }, saveWork: async () => {}, getDraft: async () => undefined, listDrafts: async () => ({}), saveDraft: async () => {}, deleteDraft: async () => {} }
  const readingRepository: ReadingRepository = {
    getProgress: async () => state,
    markSeen: async (id) => { state.seen[id] = true },
    saveProgress: async (p) => { Object.assign(state, p) },
  }
  return { works, state, server, useCase: new ReadingUseCase(workRepository, readingRepository, server.repository) }
}

describe('ReadingUseCase.getHome (목업 home())', () => {
  it('원작 캐러셀, 최신 포크 순, 이어 읽기를 만든다', async () => {
    const home = await fakes().useCase.getHome('user', '추천')
    expect(home.filtered).toBeNull()
    expect(home.originals.map((w) => w.id)).toEqual(['guunmong', 'starlight', 'postman', 'hong'])
    expect(home.forkFeed.map((w) => w.id)).toEqual(['gate', 'crown', 'postif', 'cloud', 'seal', 'pardon', 'reply'])
    expect(home.continueReading).toMatchObject({ work: { id: 'guunmong' }, episode: 2 })
    expect(home.top10[0].id).toBe('guunmong')
  })

  it('칩 필터는 공개 작품만 걸러 U02 결과를 만든다', async () => {
    const { works, useCase } = fakes()
    works.find((w) => w.id === 'hong')!.hidden = true
    const home = await useCase.getHome(null, '📜 고전')
    expect(home.filtered!.map((w) => w.id)).toEqual(['guunmong', 'gate', 'cloud', 'pardon'])
  })

  it('필터의 포크 카드에 실제 공개 원작 제목과 기준 회차를 제공한다', async () => {
    const { works, useCase } = fakes()
    const home = await useCase.getHome(null, '🛰 SF')
    for (const id of ['reply', 'postif']) {
      const fork = works.find((w) => w.id === id)!
      const parent = works.find((w) => w.id === fork.parent)!
      expect(home.forkSources[id]).toEqual({ title: parent.title, episode: fork.forkAt })
    }
    expect(home.forkSources.postman).toBeUndefined()
  })

  it('원작을 확인할 수 없거나 기준 회차가 없으면 포크 출처를 지어내지 않는다', async () => {
    const { works, useCase } = fakes()
    works.find((w) => w.id === 'postman')!.private = true
    works.find((w) => w.id === 'gate')!.forkAt = undefined
    works.find((w) => w.id === 'crown')!.parent = 'missing'
    const home = await useCase.getHome(null, '추천')
    expect(home.forkSources.reply).toBeUndefined()
    expect(home.forkSources.postif).toBeUndefined()
    expect(home.forkSources.gate).toBeUndefined()
    expect(home.forkSources.crown).toBeUndefined()
  })

  it('숨긴 원작은 홈 원작 캐러셀과 급상승 목록에서 제외한다', async () => {
    const { works, useCase } = fakes()
    works.find((w) => w.id === 'starlight')!.hidden = true
    const home = await useCase.getHome(null, '추천')
    expect(home.originals.map((w) => w.id)).toEqual(['guunmong', 'postman', 'hong'])
    expect(home.rising.map((w) => w.id)).not.toContain('starlight')
  })

  it('숨긴 회차는 이어 읽기에서 건너뛰고 본 포크를 기록한다', async () => {
    const { works, state, useCase } = fakes()
    works.find((w) => w.id === 'guunmong')!.eps[1].hidden = true
    expect((await useCase.getHome('user', '추천')).continueReading?.work.id).toBe('starlight')
    await useCase.markSeen('gate')
    expect(state.seen.gate).toBe(true)
  })

  it('비회원은 서버 독서 기록을 읽지 않아 이어 읽기가 없다', async () => {
    const { server, useCase } = fakes()
    expect((await useCase.getHome(null, '추천')).continueReading).toBeNull()
    expect(server.repository.list).not.toHaveBeenCalled()
  })

  it('서버 기록을 읽지 못하면 이어 읽기를 비워 숨기지 않고 홈 조회 실패로 알린다', async () => {
    const { server, useCase } = fakes()
    vi.mocked(server.repository.list).mockRejectedValueOnce(new Error('offline'))
    await expect(useCase.getHome('user', '추천')).rejects.toThrow('offline')
  })
})

describe('ReadingUseCase 상세·뷰어 (목업 work()·reader())', () => {
  it('볼 수 없는 작품은 null, 상세는 공개 회차·인기 포크·포크 허용 회차를 준다', async () => {
    const { works, useCase } = fakes()
    expect(await useCase.getWork('nope', null)).toBeNull()
    works.find((w) => w.id === 'hong')!.hidden = true
    expect(await useCase.getWork('hong', null)).toBeNull()
    const d = (await useCase.getWork('guunmong', null))!
    expect(d.visible.map(([, i]) => i + 1)).toEqual([1, 2, 3, 4])
    expect(d.forkList).toEqual([2, 3, 4])
    expect(d.topForks.map((f) => f.id)).toEqual(['cloud', 'gate', 'pardon'])
  })

  it('회원의 상세는 서버 기록의 이어 읽기 위치와 읽은 회차를 주고, 비회원은 기록이 없다', async () => {
    const { server, useCase } = fakes()
    expect(await useCase.getWork('guunmong', 'user')).toMatchObject({ last: 2, read: [1, 2] })
    expect(await useCase.getWork('postman', 'user')).toMatchObject({ last: undefined, read: [] })
    expect(await useCase.getWork('guunmong', null)).toMatchObject({ last: undefined, read: [] })
    expect(vi.mocked(server.repository.list)).toHaveBeenCalledTimes(2)
  })

  it('회원이 회차를 열면 서버에 열람을 기록해 홈 이어 읽기를 맨 앞으로 옮긴다', async () => {
    const { server, useCase } = fakes()
    const r = await useCase.openEpisode('starlight', 3, 'user')
    if (!r || r === 'hidden') throw new Error('episode')
    expect(r.n).toBe(3)
    expect(r.previous).toBe(2)
    expect(r.next).toBeNull()
    expect(r.paragraphs[0][0]).toEqual({ t: '정오가 지나자 재의 왕국의 사절단이 탑 앞에 도착했다.', pi: 0 })
    await expect(r.recording).resolves.toBeUndefined()
    expect(server.repository.record).toHaveBeenCalledWith('starlight', 3)
    expect(server.current()[0]).toEqual({ workId: 'starlight', lastEpisode: 3, readEpisodes: [1, 3] })
    expect((await useCase.getHome('user', '추천')).continueReading).toMatchObject({ work: { id: 'starlight' }, episode: 3 })
  })

  it('이전 회차를 다시 열면 이어 읽기 위치는 최댓값이 아니라 방금 연 회차다', async () => {
    const { server, useCase } = fakes()
    await useCase.openEpisode('guunmong', 4, 'user')
    await useCase.openEpisode('guunmong', 1, 'user')
    expect(vi.mocked(server.repository.record).mock.calls).toEqual([['guunmong', 4], ['guunmong', 1]])
    expect((await useCase.getWork('guunmong', 'user'))).toMatchObject({ last: 1, read: [1, 2, 4] })
  })

  it('비회원이 열면 읽기만 하고 서버에 기록하지 않는다', async () => {
    const { server, useCase } = fakes()
    const r = await useCase.openEpisode('starlight', 3, null)
    if (!r || r === 'hidden') throw new Error('episode')
    expect(r.n).toBe(3)
    await expect(r.recording).resolves.toBeUndefined()
    expect(server.repository.record).not.toHaveBeenCalled()
  })

  it('기록이 실패해도 회차는 열리고, 실패를 성공으로 숨기지 않고 알린다', async () => {
    const { server, useCase } = fakes()
    vi.mocked(server.repository.record).mockRejectedValueOnce(new Error('offline'))
    const r = await useCase.openEpisode('starlight', 3, 'user')
    if (!r || r === 'hidden') throw new Error('episode')
    expect(r.n).toBe(3)
    expect(r.paragraphs.length).toBeGreaterThan(0)
    await expect(r.recording).rejects.toThrow('offline')
    expect(server.current().find((x) => x.workId === 'starlight')).toEqual({ workId: 'starlight', lastEpisode: 1, readEpisodes: [1] })
  })

  it('기록 저장이 끝나기를 기다리지 않고 회차를 먼저 돌려주며, 저장 결과는 recording으로 받는다', async () => {
    const { server, useCase } = fakes()
    let finish = () => {}
    vi.mocked(server.repository.record).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const r = await useCase.openEpisode('starlight', 3, 'user')
    if (!r || r === 'hidden') throw new Error('episode')
    expect(r.n).toBe(3)
    finish()
    await expect(r.recording).resolves.toBeUndefined()
  }, 1000)

  it('범위를 벗어난 회차는 마지막 회차로, 숨긴 회차는 기록 없이 hidden으로 돌려준다', async () => {
    const { works, server, useCase } = fakes()
    const r = await useCase.openEpisode('postman', 9, 'user')
    expect(r && r !== 'hidden' && r.n).toBe(2)
    expect(server.repository.record).toHaveBeenLastCalledWith('postman', 2)
    works.find((w) => w.id === 'postman')!.eps[0].hidden = true
    vi.mocked(server.repository.record).mockClear()
    expect(await useCase.openEpisode('postman', 1, 'user')).toBe('hidden')
    expect(server.repository.record).not.toHaveBeenCalled()
  })

  it('작가가 자기 비공개 작품을 미리 읽을 때는 서버 기록을 남기지 않는다', async () => {
    const { works, server, useCase } = fakes()
    works.find((w) => w.id === 'starlight')!.private = true
    const r = await useCase.openEpisode('starlight', 1, 'user')
    expect(r && r !== 'hidden' && r.n).toBe(1)
    expect(server.repository.record).not.toHaveBeenCalled()
  })

  it('관심 소설을 토글한다', async () => {
    const { state, useCase } = fakes()
    expect(await useCase.toggleLike('guunmong')).toBe(true)
    expect(state.liked.guunmong).toBe(true)
    expect(await useCase.toggleLike('guunmong')).toBe(false)
  })

  it('빠른 이동 목록은 공개 소설·인물·회차를 담는다', async () => {
    const items = await fakes().useCase.getQuickItems(null)
    expect(items.find((x) => x.k === '인물' && x.label === '양소유')).toMatchObject({ go: '/work/guunmong' })
    expect(items.find((x) => x.k === '회차' && x.label === '구운몽 2화 돌다리 위의 팔선녀')).toMatchObject({ go: '/read/guunmong/2' })
    expect(items.filter((x) => x.k === '소설').some((x) => x.go === '/work/gate')).toBe(true)
  })
})

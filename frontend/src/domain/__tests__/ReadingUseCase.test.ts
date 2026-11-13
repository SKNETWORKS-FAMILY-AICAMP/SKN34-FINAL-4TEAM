import { describe, expect, it, vi } from 'vitest'

import { seedWorks, seedWorlds } from '../../data/mock/seed'
import type { ReadingRecord, ReadingRecordRepository } from '../repositories/ReadingRecordRepository'
import { SessionExpired } from '../repositories/ProfileRepository'
import type { WorkLikeRepository, WorkLikeState } from '../repositories/WorkLikeRepository'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import type { ReaderWorldCards } from '../entities/wiki'
import type { Work } from '../entities/work'
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

/** 서버(정본) 작품 좋아요: 저장소 대역은 서버가 확정하는 수·상태를 그대로 돌려준다. canonical이 아닌 시드 작품은 메모리 데모다. */
function likeFakes(server: WorkLikeState | null = { likes: 7, liked: false }, canonical = true) {
  const works = seedWorks(0).map((w) => ({ ...w, ...(canonical ? { canonical: true, statisticsSupported: false } : {}), likes: 5 }))
  const state: ReadingProgress = { last: {}, read: {}, seen: {}, liked: {} }
  const workRepository: WorkRepository = { listWorks: async () => works, listWorlds: async () => seedWorlds(), readWorld: async (w) => w, createFork: async () => { throw new Error('not used') }, saveWork: async () => {}, getDraft: async () => undefined, listDrafts: async () => ({}), saveDraft: async () => {}, deleteDraft: async () => {} }
  const readingRepository: ReadingRepository = { getProgress: async () => state, markSeen: async () => {}, saveProgress: async (p) => { Object.assign(state, p) } }
  const likes = { read: vi.fn(async () => server), like: vi.fn(async () => ({ likes: 8, liked: true })), unlike: vi.fn(async () => ({ likes: 6, liked: false })) } satisfies WorkLikeRepository
  return { state, likes, useCase: new ReadingUseCase(workRepository, readingRepository, recordFake([]).repository, undefined, likes) }
}

describe('ReadingUseCase 좋아요 (서버 작품)', () => {
  it('로그인 회원의 상세는 서버가 알려 준 내 좋아요 여부와 수를 쓴다', async () => {
    const { likes, state, useCase } = likeFakes({ likes: 9, liked: true })
    const d = (await useCase.getWork('guunmong', 'user'))!
    expect(likes.read).toHaveBeenCalledWith('guunmong')
    expect(d.liked).toBe(true)
    expect(d.likes).toBe(9)
    expect(state.liked).toEqual({})
  })

  it('익명 상세는 서버를 부르지 않고 목록의 수와 liked=false를 쓴다', async () => {
    const { likes, useCase } = likeFakes()
    const d = (await useCase.getWork('guunmong', null))!
    expect(likes.read).not.toHaveBeenCalled()
    expect(d.liked).toBe(false)
    expect(d.likes).toBe(5)
  })

  it('좋아요 상태를 못 읽으면 안 눌린 척하지 않고 실패로 알린다', async () => {
    const { likes, useCase } = likeFakes()
    likes.read.mockRejectedValueOnce(new Error('offline'))
    await expect(useCase.getWork('guunmong', 'user')).rejects.toThrow('offline')
  })

  it('공개 작품이 아니라고 서버가 답하면(null: 소유자의 비공개·운영 제한 작품) 상세를 막지 않고 목록의 수와 안 눌린 상태로 연다', async () => {
    const { useCase } = likeFakes(null)
    const d = (await useCase.getWork('guunmong', 'user'))!
    expect(d.liked).toBe(false)
    expect(d.likes).toBe(5)
  })

  it('만료된 세션은 익명처럼 상세를 열고 그 밖의 오류만 실패로 던진다', async () => {
    const { likes, useCase } = likeFakes()
    likes.read.mockRejectedValueOnce(new SessionExpired())
    const d = (await useCase.getWork('guunmong', 'user'))!
    expect(d.liked).toBe(false)
    expect(d.likes).toBe(5)
  })

  it('데모(canonical 아님) 작품은 저장소가 있어도 메모리 기록과 시드 수에 내 1을 더한 값을 쓴다', async () => {
    const { likes, state, useCase } = likeFakes(undefined, false)
    state.liked.guunmong = true
    const d = (await useCase.getWork('guunmong', 'user'))!
    expect(likes.read).not.toHaveBeenCalled()
    expect(d.liked).toBe(true)
    expect(d.likes).toBe(6)
  })

  it('누르기·취소는 화면이 보여 준 상태의 반대를 서버에 보내고 서버가 확정한 상태를 돌려준다', async () => {
    const { likes, state, useCase } = likeFakes()
    expect(await useCase.toggleLike('guunmong', { canonical: true, liked: false })).toBe(true)
    expect(likes.like).toHaveBeenCalledWith('guunmong')
    expect(likes.unlike).not.toHaveBeenCalled()
    expect(await useCase.toggleLike('guunmong', { canonical: true, liked: true })).toBe(false)
    expect(likes.unlike).toHaveBeenCalledWith('guunmong')
    expect(state.liked).toEqual({})
  })

  it('서버 실패는 성공으로 바꾸지 않고 던지며 메모리 기록을 건드리지 않는다', async () => {
    const { likes, state, useCase } = likeFakes()
    likes.like.mockRejectedValueOnce(new Error('공개 작품을 찾을 수 없어요.'))
    await expect(useCase.toggleLike('guunmong', { canonical: true, liked: false })).rejects.toThrow('공개 작품을 찾을 수 없어요.')
    expect(state.liked).toEqual({})
  })

  it('canonical이 아니거나 상태를 주지 않으면 저장소가 있어도 메모리 데모로 토글한다', async () => {
    const { likes, state, useCase } = likeFakes()
    expect(await useCase.toggleLike('guunmong')).toBe(true)
    expect(await useCase.toggleLike('postman', { canonical: false, liked: false })).toBe(true)
    expect(state.liked).toEqual({ guunmong: true, postman: true })
    expect(likes.like).not.toHaveBeenCalled()
  })
})

describe('ReadingUseCase.getHome (목업 home())', () => {
  it('원작 캐러셀, 최신 포크 순, 이어 읽기를 만든다', async () => {
    const home = await fakes().useCase.getHome('user', '추천')
    expect(home.filtered).toBeNull()
    expect(home.originals.map((w) => w.id)).toEqual(['guunmong', 'starlight', 'postman', 'hong'])
    expect(home.forkFeed.map((w) => w.id)).toEqual(['gate', 'crown', 'postif', 'cloud', 'seal', 'pardon', 'reply'])
    expect(home.continueReading).toMatchObject({ work: { id: 'guunmong' }, episode: 2 })
    expect(home.top10[0].id).toBe('guunmong')
  })

  it('오늘의 발견은 갱신이 오래된 작품부터 보여 준다', async () => {
    const home = await fakes().useCase.getHome(null, '추천')
    const upd = home.discover.map((w) => w.upd)
    expect(upd).toEqual(upd.slice().sort((a, b) => b - a))
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

  it('설정 위키의 기준 회차를 주면 그 회차(1~마지막 회차로 맞춤)로 공개 설정을 받고, 없으면 최신 회차로 받는다', async () => {
    const { useCase } = fakes()
    const readWorld = vi.spyOn(useCase['workRepository'], 'readWorld')
    expect((await useCase.getWork('guunmong', null, 2))!.upto).toBe(2)
    expect((await useCase.getWork('guunmong', null, 99))!.upto).toBe(4)
    expect((await useCase.getWork('guunmong', null, 0))!.upto).toBe(4)
    expect((await useCase.getWork('guunmong', null))!.upto).toBe(4)
    expect(readWorld.mock.calls.map(([, n]) => n)).toEqual([2, 4, 4, 4])
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

  it('데모 상세의 좋아요 수는 시드 수에 내 좋아요 1을 더한 값이다', async () => {
    const { state, useCase } = fakes()
    const base = (await useCase.getWork('guunmong', null))!
    expect(base.likes).toBe(12400)
    expect(base.liked).toBe(false)
    state.liked.guunmong = true
    const liked = (await useCase.getWork('guunmong', null))!
    expect(liked.likes).toBe(12401)
    expect(liked.liked).toBe(true)
  })

  it('빠른 이동 목록은 공개 소설·인물·회차를 담는다', async () => {
    const items = await fakes().useCase.getQuickItems(null)
    expect(items.find((x) => x.k === '인물' && x.label === '양소유')).toMatchObject({ go: '/work/guunmong' })
    expect(items.find((x) => x.k === '회차' && x.label === '구운몽 2화 돌다리 위의 팔선녀')).toMatchObject({ go: '/read/guunmong/2' })
    expect(items.filter((x) => x.k === '소설').some((x) => x.go === '/work/gate')).toBe(true)
  })
})

describe('ReadingUseCase 회차별 포크 수 (작품 관리 화면)', () => {
  const base = seedWorks(0)[0]
  const fork = (id: string, forkAt: number | undefined, over: Partial<Work> = {}): Work => ({ ...base, id, parent: 'src', forkAt, private: false, hidden: false, eps: [{ t: '1화', p: ['본문'] }], ...over })
  const original = { ...base, id: 'src', parent: undefined, forkAt: undefined }
  /** 작품 목록만 쓰는 대역. Error를 주면 목록 조회가 실패한다. */
  function withWorks(works: Work[] | Error) {
    const workRepository: WorkRepository = { listWorks: async () => { if (works instanceof Error) throw works; return works }, listWorlds: async () => [], readWorld: async (w) => w, createFork: async () => { throw new Error('not used') }, saveWork: async () => {}, getDraft: async () => undefined, listDrafts: async () => ({}), saveDraft: async () => {}, deleteDraft: async () => {} }
    const readingRepository: ReadingRepository = { getProgress: async () => ({ last: {}, read: {}, seen: {}, liked: {} }), markSeen: async () => {}, saveProgress: async () => {} }
    return new ReadingUseCase(workRepository, readingRepository, recordFake([]).repository)
  }

  it('이 작품에서 갈라진 공개 포크를 분기 기준 회차별로 센다 (0편인 회차는 키가 없다)', async () => {
    const counts = await withWorks([original, fork('a', 1), fork('b', 1), fork('c', 3)]).forkCountsByEpisode('src')
    expect(counts).toEqual({ 1: 2, 3: 1 })
    expect(counts[2]).toBeUndefined()
  })

  it('비공개·숨김·공개 회차가 없는 포크와 다른 작품의 포크는 세지 않는다 (소설 상세와 같은 목록이다)', async () => {
    const works = [original, fork('a', 1, { private: true }), fork('b', 1, { hidden: true }), fork('c', 1, { eps: [] }), fork('d', 1, { parent: 'other' }), fork('e', 2)]
    expect(await withWorks(works).forkCountsByEpisode('src')).toEqual({ 2: 1 })
  })

  it('포크가 없거나 분기 기준 회차를 모르는 포크뿐이면 빈 객체다', async () => {
    expect(await withWorks([original]).forkCountsByEpisode('src')).toEqual({})
    expect(await withWorks([original, fork('a', undefined)]).forkCountsByEpisode('src')).toEqual({})
  })

  it('작품 목록을 읽지 못하면 0편으로 채우지 않고 오류를 그대로 알린다', async () => {
    await expect(withWorks(new Error('목록을 읽지 못했어요.')).forkCountsByEpisode('src')).rejects.toThrow('목록을 읽지 못했어요.')
  })
})

describe('ReadingUseCase 연결된 세계관의 설정 위키 (DEC-46)', () => {
  const served = (worldId: string | null): ReaderWorldCards => ({ workId: 'guunmong', worldId, upto: 2, cards: [], relationships: [], relationshipStatus: 'current' })
  const setup = (readWorldCards?: WorkRepository['readWorldCards']) =>
    new ReadingUseCase({ readWorldCards } as unknown as WorkRepository, {} as ReadingRepository, recordFake([]).repository)
  const server = { id: 'guunmong', canonical: true }

  it('서버 작품에 연결된 세계관이 있으면 기준 회차를 정수로 맞춰 읽은 카드를 돌려준다', async () => {
    const read = vi.fn(async () => served('world-1'))
    const useCase = setup(read)
    expect(await useCase.linkedWorldCards(server, 2.7)).toEqual(served('world-1'))
    expect(read).toHaveBeenLastCalledWith('guunmong', 2)
    // 기준 회차가 없거나 1보다 작으면 보내지 않아 서버가 발행된 최대 회차를 쓴다.
    await useCase.linkedWorldCards(server)
    expect(read).toHaveBeenLastCalledWith('guunmong', undefined)
    await useCase.linkedWorldCards(server, 0)
    expect(read).toHaveBeenLastCalledWith('guunmong', undefined)
  })

  it('연결된 세계관이 없는 작품은 null이라 기존 작품 설정 위키를 쓴다', async () => {
    expect(await setup(async () => served(null)).linkedWorldCards(server, 1)).toBeNull()
  })

  it('메모리 데모 작품과 세계관 카드를 읽지 않는 저장소는 서버를 부르지 않고 null이다', async () => {
    const read = vi.fn(async () => served('world-1'))
    expect(await setup(read).linkedWorldCards({ id: 'guunmong' }, 1)).toBeNull()
    expect(read).not.toHaveBeenCalled()
    expect(await setup().linkedWorldCards(server, 1)).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'

import { seedWorks, seedWorlds } from '../../data/mock/seed'
import { SessionExpired } from '../repositories/ProfileRepository'
import type { WorkLikeRepository, WorkLikeState } from '../repositories/WorkLikeRepository'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import { ReadingUseCase } from '../usecases/ReadingUseCase'

function fakes(progress: Partial<ReadingProgress> = {}) {
  const works = seedWorks(0)
  const state: ReadingProgress = { last: { guunmong: 2, starlight: 1 }, read: {}, seen: {}, liked: {}, ...progress }
  const workRepository: WorkRepository = { listWorks: async () => works, listWorlds: async () => seedWorlds(), readWorld: async w => w, createFork: async () => { throw new Error('not used') }, saveWork: async () => {}, getDraft: async () => undefined, listDrafts: async () => ({}), saveDraft: async () => {}, deleteDraft: async () => {} }
  const readingRepository: ReadingRepository = {
    getProgress: async () => state,
    markSeen: async (id) => { state.seen[id] = true },
    saveProgress: async (p) => { Object.assign(state, p) },
  }
  return { works, state, useCase: new ReadingUseCase(workRepository, readingRepository) }
}

/** 서버(정본) 작품 좋아요: 저장소 대역은 서버가 확정하는 수·상태를 그대로 돌려준다. canonical이 아닌 시드 작품은 메모리 데모다. */
function likeFakes(server: WorkLikeState | null = { likes: 7, liked: false }, canonical = true) {
  const works = seedWorks(0).map((w) => ({ ...w, ...(canonical ? { canonical: true, statisticsSupported: false } : {}), likes: 5 }))
  const state: ReadingProgress = { last: {}, read: {}, seen: {}, liked: {} }
  const workRepository: WorkRepository = { listWorks: async () => works, listWorlds: async () => seedWorlds(), readWorld: async (w) => w, createFork: async () => { throw new Error('not used') }, saveWork: async () => {}, getDraft: async () => undefined, listDrafts: async () => ({}), saveDraft: async () => {}, deleteDraft: async () => {} }
  const readingRepository: ReadingRepository = { getProgress: async () => state, markSeen: async () => {}, saveProgress: async (p) => { Object.assign(state, p) } }
  const likes = { read: vi.fn(async () => server), like: vi.fn(async () => ({ likes: 8, liked: true })), unlike: vi.fn(async () => ({ likes: 6, liked: false })) } satisfies WorkLikeRepository
  return { works, state, likes, useCase: new ReadingUseCase(workRepository, readingRepository, undefined, likes) }
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

  it('공개 작품이 아니라고 서버가 답하면(null) 상세를 막지 않고 목록의 수와 안 눌린 상태로 연다', async () => {
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

  it('소유자가 여는 비공개 서버 작품은 서버에 묻지 않고 목록의 수와 안 눌린 상태로 연다', async () => {
    const { works, likes, useCase } = likeFakes()
    works.find((w) => w.id === 'starlight')!.private = true
    const d = (await useCase.getWork('starlight', 'user'))!
    expect(d.work.id).toBe('starlight')
    expect(likes.read).not.toHaveBeenCalled()
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
    const home = await fakes().useCase.getHome(null, '추천')
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
    expect((await useCase.getHome(null, '추천')).continueReading?.work.id).toBe('starlight')
    await useCase.markSeen('gate')
    expect(state.seen.gate).toBe(true)
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
    expect(d.last).toBe(2)
  })

  it('회차를 열면 이어 읽기를 맨 앞으로 옮기고 읽음을 기록한다', async () => {
    const { state, useCase } = fakes()
    const r = await useCase.openEpisode('starlight', 3, 'user')
    if (!r || r === 'hidden') throw new Error('episode')
    expect(r.n).toBe(3)
    expect(r.previous).toBe(2)
    expect(r.next).toBeNull()
    expect(r.paragraphs[0][0]).toEqual({ t: '정오가 지나자 재의 왕국의 사절단이 탑 앞에 도착했다.', pi: 0 })
    expect(Object.keys(state.last)[0]).toBe('starlight')
    expect(state.last.starlight).toBe(3)
    expect(state.read.starlight).toEqual([3])
    expect((await useCase.getHome('user', '추천')).continueReading).toMatchObject({ work: { id: 'starlight' }, episode: 3 })
  })

  it('범위를 벗어난 회차는 마지막 회차로, 숨긴 회차는 hidden으로 돌려준다', async () => {
    const { works, useCase } = fakes()
    const r = await useCase.openEpisode('postman', 9, 'user')
    expect(r && r !== 'hidden' && r.n).toBe(2)
    works.find((w) => w.id === 'postman')!.eps[0].hidden = true
    expect(await useCase.openEpisode('postman', 1, 'user')).toBe('hidden')
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

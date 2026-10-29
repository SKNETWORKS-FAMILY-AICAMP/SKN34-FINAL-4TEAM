import { describe, expect, it } from 'vitest'

import { seedWorks, seedWorlds } from '../../data/mock/seed'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import { ReadingUseCase } from '../usecases/ReadingUseCase'

function fakes(progress: Partial<ReadingProgress> = {}) {
  const works = seedWorks(0)
  const state: ReadingProgress = { last: { guunmong: 2, starlight: 1 }, read: {}, seen: {}, liked: {}, ...progress }
  const workRepository: WorkRepository = { listWorks: async () => works, listWorlds: async () => seedWorlds(), saveWork: async () => {}, getDraft: async () => undefined, saveDraft: async () => {}, deleteDraft: async () => {} }
  const readingRepository: ReadingRepository = {
    getProgress: async () => state,
    markSeen: async (id) => { state.seen[id] = true },
    saveProgress: async (p) => { Object.assign(state, p) },
  }
  return { works, state, useCase: new ReadingUseCase(workRepository, readingRepository) }
}

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

  it('빠른 이동 목록은 공개 소설·인물·회차를 담는다', async () => {
    const items = await fakes().useCase.getQuickItems(null)
    expect(items.find((x) => x.k === '인물' && x.label === '양소유')).toMatchObject({ go: '/work/guunmong' })
    expect(items.find((x) => x.k === '회차' && x.label === '구운몽 2화 돌다리 위의 팔선녀')).toMatchObject({ go: '/read/guunmong/2' })
    expect(items.filter((x) => x.k === '소설').some((x) => x.go === '/work/gate')).toBe(true)
  })
})

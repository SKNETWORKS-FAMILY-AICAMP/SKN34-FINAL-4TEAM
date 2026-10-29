import { describe, expect, it } from 'vitest'

import { seedWorks, seedWorlds } from '../../data/mock/seed'
import type { ReadingProgress, ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import { ReadingUseCase } from '../usecases/ReadingUseCase'

function fakes(progress: Partial<ReadingProgress> = {}) {
  const works = seedWorks(0)
  const state: ReadingProgress = { last: { guunmong: 2, starlight: 1 }, read: {}, seen: {}, liked: {}, ...progress }
  const workRepository: WorkRepository = { listWorks: async () => works, listWorlds: async () => seedWorlds() }
  const readingRepository: ReadingRepository = {
    getProgress: async () => state,
    markSeen: async (id) => { state.seen[id] = true },
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

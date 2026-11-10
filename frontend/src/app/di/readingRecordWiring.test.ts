// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

import { HttpReadingRecordRepository } from '../../data/content/HttpReadingRecordRepository'
import { InMemoryReadingRecordRepository } from '../../data/mock/InMemoryRepositories'
import { createAppContainer } from './container'

afterEach(() => vi.unstubAllEnvs())

it('서버 모드는 독서 기록을 Content HTTP 저장소로 등록한다', () => {
  expect(createAppContainer().resolve('readingRecordRepository')).toBeInstanceOf(HttpReadingRecordRepository)
})

it('목업 모드는 독서 기록을 mockDb.progress 메모리로 등록해 홈·서재·뷰어가 같은 기록을 본다', async () => {
  vi.stubEnv('MODE', 'mockup')
  const container = createAppContainer()
  expect(container.resolve('readingRecordRepository')).toBeInstanceOf(InMemoryReadingRecordRepository)
  expect((await container.resolve('readingUseCase').getHome('user', '추천')).continueReading).toMatchObject({ work: { id: 'guunmong' }, episode: 2 })
  expect((await container.resolve('libraryUseCase').getRead()).recent.map((r) => [r.work.id, r.n])).toEqual([['guunmong', 2], ['starlight', 1]])
  await container.resolve('readingUseCase').openEpisode('starlight', 3, 'user')
  expect((await container.resolve('libraryUseCase').getRead()).recent.map((r) => [r.work.id, r.n])).toEqual([['starlight', 3], ['guunmong', 2]])
  expect((await container.resolve('readingUseCase').getHome('user', '추천')).continueReading).toMatchObject({ work: { id: 'starlight' }, episode: 3 })
})

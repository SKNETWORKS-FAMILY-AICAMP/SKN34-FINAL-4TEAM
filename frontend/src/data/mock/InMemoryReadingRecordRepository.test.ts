import { describe, expect, it } from 'vitest'

import { createFixtureDb } from './fixtureDb'
import { InMemoryReadingRecordRepository } from './InMemoryRepositories'

describe('InMemoryReadingRecordRepository (mockDb.progress 기반 목업)', () => {
  it('시드 진행 상태를 최근 순 독서 기록으로 보여 준다', async () => {
    expect(await new InMemoryReadingRecordRepository(createFixtureDb()).list()).toEqual([
      { workId: 'guunmong', lastEpisode: 2, readEpisodes: [1, 2] },
      { workId: 'starlight', lastEpisode: 1, readEpisodes: [1] },
    ])
  })

  it('회차를 열면 위치를 그 회차로(최댓값이 아니라) 옮기고 읽은 회차에 한 번만 더하며 작품을 맨 앞으로 올린다', async () => {
    const db = createFixtureDb()
    const repo = new InMemoryReadingRecordRepository(db)
    await repo.record('starlight', 3)
    await repo.record('starlight', 1)
    await repo.record('starlight', 1)
    expect(await repo.list()).toEqual([
      { workId: 'starlight', lastEpisode: 1, readEpisodes: [1, 3] },
      { workId: 'guunmong', lastEpisode: 2, readEpisodes: [1, 2] },
    ])
    // 같은 상태를 읽는 다른 목업(캐릭터 챗 등)이 보도록 정본은 mockDb.progress다.
    expect(db.progress.last.starlight).toBe(1)
    expect(db.progress.read.starlight).toEqual([1, 3])
  })

  it('처음 읽는 작품도 기록하고, 읽은 회차는 오름차순으로 돌려준다', async () => {
    const repo = new InMemoryReadingRecordRepository(createFixtureDb())
    await repo.record('postman', 2)
    await repo.record('postman', 1)
    expect((await repo.list())[0]).toEqual({ workId: 'postman', lastEpisode: 1, readEpisodes: [1, 2] })
  })

  it('기록을 지우면 위치와 읽은 회차가 함께 사라지고, 기록이 없어도 같은 결과다', async () => {
    const db = createFixtureDb()
    const repo = new InMemoryReadingRecordRepository(db)
    await repo.remove('guunmong')
    await repo.remove('guunmong')
    await repo.remove('nope')
    expect((await repo.list()).map((r) => r.workId)).toEqual(['starlight'])
    expect([db.progress.last.guunmong, db.progress.read.guunmong]).toEqual([undefined, undefined])
  })

  it('반환값을 고쳐도 저장 상태는 바뀌지 않는다', async () => {
    const repo = new InMemoryReadingRecordRepository(createFixtureDb())
    const [first] = await repo.list()
    first.readEpisodes.push(99)
    first.lastEpisode = 99
    expect((await repo.list())[0]).toEqual({ workId: 'guunmong', lastEpisode: 2, readEpisodes: [1, 2] })
  })
})

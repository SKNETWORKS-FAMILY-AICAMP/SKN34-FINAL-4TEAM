import { describe, expect, it } from 'vitest'

import { OperationsError } from '../../domain/entities/operations'
import { isPub } from '../../domain/entities/work'
import { createFixtureDb } from './fixtureDb'
import { InMemoryOperationsWorkRepository } from './InMemoryOperationsWorkRepository'

describe('InMemoryOperationsWorkRepository (서버 없는 시연·테스트용)', () => {
  it('데모 작품을 운영 작품 계약 형태(종류·권리·공개 상태)로 보여 준다', async () => {
    const db = createFixtureDb()
    db.works.find((w) => w.id === 'starlight')!.private = true
    const rows = await new InMemoryOperationsWorkRepository(db).list()
    expect(rows).toHaveLength(db.works.length)
    expect(rows.find((r) => r.workId === 'guunmong')).toEqual({
      workId: 'guunmong', ownerId: '운영팀', title: '구운몽', authorName: '김만중', originKind: 'original',
      creationType: 'external_derivative', rightsConfirmed: true, visibility: 'public', restricted: false,
    })
    expect(rows.find((r) => r.workId === 'starlight')).toMatchObject({ creationType: 'original', visibility: 'private' })
    const fork = db.works.find((w) => w.parent)!
    expect(rows.find((r) => r.workId === fork.id)).toMatchObject({ originKind: 'fork' })
  })

  it('운영 제한은 데모 작품을 공개에서 빼고 해제하면 되돌린다', async () => {
    const db = createFixtureDb()
    const repo = new InMemoryOperationsWorkRepository(db)
    const work = () => db.works.find((w) => w.id === 'guunmong')!
    await repo.setRestriction('guunmong', true)
    expect((await repo.list()).find((r) => r.workId === 'guunmong')?.restricted).toBe(true)
    expect(isPub(work())).toBe(false)
    await repo.setRestriction('guunmong', false)
    expect((await repo.list()).find((r) => r.workId === 'guunmong')?.restricted).toBe(false)
    expect(isPub(work())).toBe(true)
  })

  it('없는 작품의 제한은 대상을 찾을 수 없다는 안내 오류다', async () => {
    await expect(new InMemoryOperationsWorkRepository(createFixtureDb()).setRestriction('missing', true)).rejects.toThrow(OperationsError)
  })
})

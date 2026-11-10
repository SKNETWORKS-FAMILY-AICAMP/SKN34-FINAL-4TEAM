import { describe, expect, it } from 'vitest'

import { OperationsError } from '../../domain/entities/operations'
import { InMemoryEventRepository } from './InMemoryEventRepository'

const input = { title: '가을 이벤트', body: '본문', startsAt: '2026-11-08T00:00:00.000Z', endsAt: null }
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

describe('InMemoryEventRepository (서버 없는 시연·테스트용)', () => {
  it('서버처럼 UUID와 등록·수정 시각을 부여하고 목록은 최신 등록순이다', async () => {
    const repo = new InMemoryEventRepository()
    const first = await repo.create(input)
    const second = await repo.create({ ...input, title: '겨울 이벤트' })
    expect(first.id).toMatch(uuid)
    expect(first).toMatchObject({ ...input, createdAt: first.updatedAt })
    expect((await repo.listAdmin()).map((row) => row.title)).toEqual(['겨울 이벤트', '가을 이벤트'])
    expect(await repo.listPublic()).toEqual(await repo.listAdmin())
    expect(await repo.getPublic(second.id)).toEqual(second)
  })

  it('전체 수정은 등록 시각을 지키고 생략한 기간을 비우며 목록 순서를 바꾸지 않는다', async () => {
    const repo = new InMemoryEventRepository()
    const first = await repo.create({ ...input, endsAt: '2026-11-09T00:00:00.000Z' })
    await repo.create({ ...input, title: '겨울 이벤트' })
    const saved = await repo.update(first.id, { title: '수정', body: '새 본문', startsAt: null, endsAt: null })
    expect(saved).toMatchObject({ id: first.id, createdAt: first.createdAt, title: '수정', body: '새 본문', startsAt: null, endsAt: null })
    expect((await repo.listAdmin()).map((row) => row.title)).toEqual(['겨울 이벤트', '수정'])
  })

  it('없는 이벤트의 상세는 null, 수정·삭제는 대상을 찾을 수 없다는 안내 오류다', async () => {
    const repo = new InMemoryEventRepository()
    expect(await repo.getPublic('missing')).toBeNull()
    await expect(repo.update('missing', input)).rejects.toThrow(OperationsError)
    await expect(repo.remove('missing')).rejects.toThrow(OperationsError)
  })

  it('삭제하면 공개 목록·상세에서도 바로 사라진다', async () => {
    const repo = new InMemoryEventRepository()
    const row = await repo.create(input)
    await repo.remove(row.id)
    expect(await repo.listPublic()).toEqual([])
    expect(await repo.getPublic(row.id)).toBeNull()
  })

  it('돌려준 객체를 바꿔도 저장된 값은 변하지 않는다', async () => {
    const repo = new InMemoryEventRepository()
    const row = await repo.create(input)
    row.title = '바꿈'
    ;(await repo.listAdmin())[0].title = '또 바꿈'
    expect((await repo.getPublic(row.id))?.title).toBe('가을 이벤트')
  })
})

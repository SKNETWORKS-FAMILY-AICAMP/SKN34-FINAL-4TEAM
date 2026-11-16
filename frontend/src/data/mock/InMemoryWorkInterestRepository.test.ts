import { describe, expect, it } from 'vitest'

import { InMemoryWorkInterestRepository } from './InMemoryWorkInterestRepository'

describe('InMemoryWorkInterestRepository (서버 없는 시연·테스트용)', () => {
  it('최근 등록한 작품이 앞에 오고 이미 담은 작품을 다시 담아도 순서가 바뀌지 않는다', async () => {
    const repo = new InMemoryWorkInterestRepository()
    await repo.add('a')
    await repo.add('b')
    await repo.add('c')
    await repo.add('a')
    expect(await repo.list()).toEqual(['c', 'b', 'a'])
  })

  it('담지 않은 작품을 빼도 성공이고 다른 작품은 그대로다', async () => {
    const repo = new InMemoryWorkInterestRepository()
    await repo.add('a')
    await repo.add('b')
    await repo.remove('a')
    await repo.remove('a')
    await repo.remove('missing')
    expect(await repo.list()).toEqual(['b'])
  })

  it('돌려준 목록을 고쳐도 저장소에는 영향이 없다', async () => {
    const repo = new InMemoryWorkInterestRepository()
    await repo.add('a')
    ;(await repo.list()).push('x')
    expect(await repo.list()).toEqual(['a'])
  })
})

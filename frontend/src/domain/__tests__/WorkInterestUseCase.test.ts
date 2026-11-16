import { describe, expect, it } from 'vitest'

import type { WorkInterestRepository } from '../repositories/WorkInterestRepository'
import { WorkInterestUseCase } from '../usecases/WorkInterestUseCase'

/** 호출 기록을 남기는 Fake. 목록은 최근 등록순 id다. */
function fake(ids: string[] = []) {
  const calls: string[] = []
  const repository: WorkInterestRepository = {
    list: async () => [...ids],
    add: async (id) => { calls.push(`add:${id}`) },
    remove: async (id) => { calls.push(`remove:${id}`) },
  }
  return { repository, calls }
}

describe('WorkInterestUseCase', () => {
  it('관심 목록에 있는 작품만 관심 작품으로 본다', async () => {
    const useCase = new WorkInterestUseCase(fake(['b', 'a']).repository)
    expect(await useCase.isInterested('a')).toBe(true)
    expect(await useCase.isInterested('c')).toBe(false)
  })

  it('켜면 담고 끄면 뺀다', async () => {
    const { repository, calls } = fake()
    const useCase = new WorkInterestUseCase(repository)
    await useCase.setInterested('a', true)
    await useCase.setInterested('a', false)
    expect(calls).toEqual(['add:a', 'remove:a'])
  })

  it('저장소 실패는 숨기지 않고 그대로 알린다', async () => {
    const repository: WorkInterestRepository = {
      list: async () => { throw new Error('목록 실패') },
      add: async () => { throw new Error('등록 실패') },
      remove: async () => { throw new Error('해제 실패') },
    }
    const useCase = new WorkInterestUseCase(repository)
    await expect(useCase.isInterested('a')).rejects.toThrow('목록 실패')
    await expect(useCase.setInterested('a', true)).rejects.toThrow('등록 실패')
    await expect(useCase.setInterested('a', false)).rejects.toThrow('해제 실패')
  })
})

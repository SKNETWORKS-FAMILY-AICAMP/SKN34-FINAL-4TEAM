import { describe, expect, it, vi } from 'vitest'

import type { WorldStudioRepository } from '../repositories/WorldStudioRepository'
import { WorldStudioUseCase } from '../usecases/WorldStudioUseCase'

describe('WorldStudioUseCase 되돌리기·삭제', () => {
  const base = { listStudio: vi.fn(), read: vi.fn(), create: vi.fn(), saveStudio: vi.fn(), setPublication: vi.fn() }
  const useCase = (repository: object) => new WorldStudioUseCase(repository as WorldStudioRepository)

  it('저장소가 없는 데모는 지원하지 않는다고 알리며 아무것도 보내지 않는다', () => {
    expect(useCase({ ...base, deleteStudio: vi.fn() }).supportsDelete).toBe(true)
    const demo = useCase(base)
    expect(demo.supportsDelete).toBe(false)
    expect(() => demo.restoreRevision('w', 'r', 1)).toThrow('데모에서는 확정 버전 되돌리기를 지원하지 않습니다.')
    expect(() => demo.deleteWorld('w')).toThrow('데모에서는 세계관 삭제를 지원하지 않습니다.')
  })

  it('되돌리기와 삭제는 같은 인자·취소 신호로 저장소에 넘기고 그 결과를 그대로 돌려준다', async () => {
    const world = { id: 'w' }
    const repository = { ...base, restoreRevision: vi.fn(async () => world), deleteStudio: vi.fn(async () => undefined) }
    const cases = useCase(repository)
    const signal = new AbortController().signal
    await expect(cases.restoreRevision('w', 'r', 4, signal)).resolves.toBe(world)
    expect(repository.restoreRevision).toHaveBeenCalledWith('w', 'r', 4, signal)
    await expect(cases.deleteWorld('w', signal)).resolves.toBeUndefined()
    expect(repository.deleteStudio).toHaveBeenCalledWith('w', signal)
  })
})

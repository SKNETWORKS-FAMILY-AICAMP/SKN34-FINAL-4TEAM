import { describe, expect, it, vi } from 'vitest'

import { WORLD_COVER_MAX_BYTES, worldCoverError } from '../entities/studioWorld'
import type { WorldStudioRepository } from '../repositories/WorldStudioRepository'
import { WorldStudioUseCase } from '../usecases/WorldStudioUseCase'

const upload = (type = 'image/png', size = 10) => new File([new Uint8Array(size)], 'cover', { type })

describe('세계관 표지 사전 검사', () => {
  it('PNG·JPEG·WebP이고 5 MiB 이하인 파일만 통과한다', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(worldCoverError(upload(type)), type).toBeNull()
    expect(worldCoverError(upload('image/png', WORLD_COVER_MAX_BYTES))).toBeNull() // 한계 크기는 통과
  })

  it('빈 파일·다른 형식·한계를 넘는 크기는 이유를 알려 거른다', () => {
    expect(worldCoverError(upload('image/png', 0))).toBe('빈 파일은 표지로 쓸 수 없어요.')
    for (const type of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/plain', '']) expect(worldCoverError(upload(type)), type).toBe('PNG·JPEG·WebP 이미지만 표지로 쓸 수 있어요.')
    expect(worldCoverError(upload('image/jpeg', WORLD_COVER_MAX_BYTES + 1))).toBe('표지는 5 MiB 이하여야 해요.')
  })
})

describe('WorldStudioUseCase 표지', () => {
  const base = { listStudio: vi.fn(), read: vi.fn(), create: vi.fn(), saveStudio: vi.fn(), setPublication: vi.fn() }
  const supporting = () => ({ ...base, setCover: vi.fn(async () => undefined) })
  const useCase = (repository: object) => new WorldStudioUseCase(repository as WorldStudioRepository)

  it('표지 저장소가 있으면 지원하고, 없는 데모는 지원하지 않는다고 알리며 아무것도 보내지 않는다', () => {
    expect(useCase(supporting()).supportsCover).toBe(true)
    const demo = useCase(base)
    expect(demo.supportsCover).toBe(false)
    expect(() => demo.setCover('w', upload())).toThrow('데모에서는 표지 업로드를 지원하지 않습니다.')
    expect(() => demo.removeCover('w')).toThrow('데모에서는 표지 삭제를 지원하지 않습니다.')
    expect(() => demo.cover('w')).toThrow('데모에서는 표지를 읽지 않습니다.')
  })

  it('올리기 전에 형식·크기를 거르고, 통과한 파일만 같은 파일·취소 신호와 함께 저장소로 보낸다', async () => {
    const repository = supporting()
    const cases = useCase(repository)
    expect(() => cases.setCover('w', upload('image/gif'))).toThrow('PNG·JPEG·WebP')
    expect(() => cases.setCover('w', upload('image/png', WORLD_COVER_MAX_BYTES + 1))).toThrow('5 MiB')
    expect(repository.setCover).not.toHaveBeenCalled()
    const file = upload('image/webp')
    const signal = new AbortController().signal
    await cases.setCover('w', file, signal)
    expect(repository.setCover).toHaveBeenCalledWith('w', file, signal)
  })
})

import { describe, expect, it, vi } from 'vitest'

import { cardImageError, WORLD_COVER_MAX_BYTES } from '../entities/studioWorld'
import type { WorldStudioRepository } from '../repositories/WorldStudioRepository'
import { WorldStudioUseCase } from '../usecases/WorldStudioUseCase'

const upload = (type = 'image/png', size = 10) => new File([new Uint8Array(size)], 'card', { type })

describe('설정 카드 이미지 사전 검사', () => {
  it('세계관 표지와 같은 규칙으로 PNG·JPEG·WebP이고 5 MiB 이하인 파일만 통과한다', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(cardImageError(upload(type)), type).toBeNull()
    expect(cardImageError(upload('image/png', WORLD_COVER_MAX_BYTES))).toBeNull() // 한계 크기는 통과
  })

  it('빈 파일·다른 형식·한계를 넘는 크기는 이유를 알려 거른다', () => {
    expect(cardImageError(upload('image/png', 0))).toBe('빈 파일은 이미지로 쓸 수 없어요.')
    for (const type of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/plain', '']) expect(cardImageError(upload(type)), type).toBe('PNG·JPEG·WebP 이미지만 올릴 수 있어요.')
    expect(cardImageError(upload('image/jpeg', WORLD_COVER_MAX_BYTES + 1))).toBe('이미지는 5 MiB 이하여야 해요.')
  })
})

describe('WorldStudioUseCase 카드 이미지', () => {
  const base = { listStudio: vi.fn(), read: vi.fn(), create: vi.fn(), saveStudio: vi.fn(), setPublication: vi.fn() }
  const blob = new Blob(['png'], { type: 'image/png' })
  const supporting = () => ({ ...base, uploadCardImage: vi.fn(async () => 'image-1'), readCardImage: vi.fn(async () => blob) })
  const useCase = (repository: object) => new WorldStudioUseCase(repository as WorldStudioRepository)

  it('카드 이미지 저장소가 있으면 지원하고, 없는 데모는 지원하지 않는다고 알리며 아무것도 보내지 않는다', () => {
    expect(useCase(supporting()).supportsCardImages).toBe(true)
    const demo = useCase(base)
    expect(demo.supportsCardImages).toBe(false)
    expect(() => demo.uploadCardImage('w', upload())).toThrow('데모에서는 이미지 업로드를 지원하지 않습니다.')
    expect(() => demo.cardImage('w', 'image-1')).toThrow('데모에서는 이미지를 읽지 않습니다.')
  })

  it('올리기 전에 형식·크기를 거르고, 통과한 파일만 같은 파일·취소 신호와 함께 저장소로 보내 새 이미지 id를 돌려준다', async () => {
    const repository = supporting()
    const cases = useCase(repository)
    expect(() => cases.uploadCardImage('w', upload('image/gif'))).toThrow('PNG·JPEG·WebP')
    expect(() => cases.uploadCardImage('w', upload('image/png', WORLD_COVER_MAX_BYTES + 1))).toThrow('5 MiB')
    expect(repository.uploadCardImage).not.toHaveBeenCalled()
    const file = upload('image/webp')
    const signal = new AbortController().signal
    await expect(cases.uploadCardImage('w', file, signal)).resolves.toBe('image-1')
    expect(repository.uploadCardImage).toHaveBeenCalledWith('w', file, signal)
  })

  it('이미지 읽기는 세계관·이미지 id와 취소 신호를 그대로 저장소에 넘기고 받은 이미지를 돌려준다', async () => {
    const repository = supporting()
    const signal = new AbortController().signal
    await expect(useCase(repository).cardImage('w', 'image-1', signal)).resolves.toBe(blob)
    expect(repository.readCardImage).toHaveBeenCalledWith('w', 'image-1', signal)
  })
})

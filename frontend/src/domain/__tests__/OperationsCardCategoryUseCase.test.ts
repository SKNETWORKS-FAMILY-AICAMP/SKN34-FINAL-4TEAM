import { describe, expect, it, vi } from 'vitest'

import { CARD_CATEGORY_ICON_MAX, CARD_CATEGORY_NAME_MAX } from '../entities/cardCategory'
import { OperationsError, OperationsForbidden } from '../entities/operations'
import type { OperationsCardCategoryRepository } from '../repositories/OperationsCardCategoryRepository'
import { OperationsCardCategoryUseCase } from '../usecases/OperationsCardCategoryUseCase'

function setup() {
  const repository: OperationsCardCategoryRepository = {
    list: vi.fn(async () => []), create: vi.fn(async () => undefined), update: vi.fn(async () => undefined), reorder: vi.fn(async () => undefined),
  }
  return { repository, useCase: new OperationsCardCategoryUseCase(repository) }
}

describe('OperationsCardCategoryUseCase', () => {
  it('추가는 이름을 다듬고 비어 있지 않은 아이콘만 보낸다', async () => {
    const { repository, useCase } = setup()
    await useCase.create({ name: '  마법  ', icon: '' })
    await useCase.create({ name: '마법', icon: ' 🔮 ' })
    expect(repository.create).toHaveBeenNthCalledWith(1, { name: '마법' })
    expect(repository.create).toHaveBeenNthCalledWith(2, { name: '마법', icon: '🔮' })
  })

  it('빈 이름·긴 이름·긴 아이콘은 요청 없이 안내한다', async () => {
    const { repository, useCase } = setup()
    await expect(useCase.create({ name: '   ' })).rejects.toThrow(OperationsError)
    await expect(useCase.create({ name: 'x'.repeat(CARD_CATEGORY_NAME_MAX + 1) })).rejects.toThrow(OperationsError)
    await expect(useCase.create({ name: '마법', icon: 'x'.repeat(CARD_CATEGORY_ICON_MAX + 1) })).rejects.toThrow(OperationsError)
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('아이콘 한도는 UTF-16 길이가 아니라 글자(코드 포인트) 수라 이모지 8개는 통과하고 9개는 거절한다', async () => {
    const { repository, useCase } = setup()
    await useCase.create({ name: '마법', icon: '🐉'.repeat(CARD_CATEGORY_ICON_MAX) })
    expect(repository.create).toHaveBeenCalledWith({ name: '마법', icon: '🐉'.repeat(CARD_CATEGORY_ICON_MAX) })
    await expect(useCase.update('category-09', { icon: '🐉'.repeat(CARD_CATEGORY_ICON_MAX + 1) })).rejects.toThrow(OperationsError)
  })

  it('수정은 바꿀 값만 보내고 아이콘 빈 문자열은 지우기로 그대로 보낸다', async () => {
    const { repository, useCase } = setup()
    await useCase.update('location', { name: ' 장소 ', active: false })
    await useCase.update('location', { icon: '' })
    expect(repository.update).toHaveBeenNthCalledWith(1, 'location', { name: '장소', active: false })
    expect(repository.update).toHaveBeenNthCalledWith(2, 'location', { icon: '' })
    await expect(useCase.update('location', { name: '' })).rejects.toThrow(OperationsError)
  })

  it('조회 권한이 없으면(403) 실패가 아니라 null이다', async () => {
    const { repository, useCase } = setup()
    vi.mocked(repository.list).mockRejectedValueOnce(new OperationsForbidden('권한 없음'))
    expect(await useCase.list()).toBeNull()
  })

  it('순서 저장은 받은 코드 순서를 그대로 보낸다', async () => {
    const { repository, useCase } = setup()
    await useCase.reorder(['b', 'a'])
    expect(repository.reorder).toHaveBeenCalledWith(['b', 'a'])
  })
})

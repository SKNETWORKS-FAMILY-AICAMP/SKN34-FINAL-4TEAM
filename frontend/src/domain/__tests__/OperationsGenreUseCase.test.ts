import { describe, expect, it, vi } from 'vitest'

import { OperationsError } from '../entities/operations'
import type { OperationsGenreRepository } from '../repositories/OperationsGenreRepository'
import { OperationsGenreUseCase } from '../usecases/OperationsGenreUseCase'

const setup = () => {
  const repository = { list: vi.fn(async () => []), create: vi.fn(async () => {}), update: vi.fn(async () => {}), reorder: vi.fn(async () => {}) } satisfies OperationsGenreRepository
  return { repository, useCase: new OperationsGenreUseCase(repository) }
}

describe('운영 장르 추가', () => {
  it('이름 앞뒤 공백을 지워 보내고 아이콘이 비면 보내지 않는다', async () => {
    const { repository, useCase } = setup()
    await useCase.create({ name: '  사극  ', emoji: '  ' })
    await useCase.create({ name: '웹툰', emoji: ' 🎬 ' })
    expect(repository.create.mock.calls).toEqual([[{ name: '사극' }], [{ name: '웹툰', emoji: '🎬' }]])
  })

  it('이름이 비었거나 30자를 넘거나 아이콘이 8자를 넘으면 서버에 보내지 않고 안내를 던진다', async () => {
    const { repository, useCase } = setup()
    await expect(useCase.create({ name: '   ' })).rejects.toThrow(new OperationsError('장르 이름을 1~30자로 적어 주세요.'))
    await expect(useCase.create({ name: '가'.repeat(31) })).rejects.toBeInstanceOf(OperationsError)
    await expect(useCase.create({ name: '사극', emoji: '123456789' })).rejects.toThrow(new OperationsError('아이콘은 8자 이하로 적어 주세요.'))
    await expect(useCase.create({ name: '가'.repeat(30), emoji: '12345678' })).resolves.toBeUndefined()
    expect(repository.create).toHaveBeenCalledTimes(1)
  })
})

describe('운영 장르 수정', () => {
  it('바꿀 값만 보내고 이름은 공백을 지우며 아이콘 빈 문자열은 아이콘 지우기로 그대로 보낸다', async () => {
    const { repository, useCase } = setup()
    await useCase.update('genre-31', { name: ' 사극 ' })
    await useCase.update('genre-31', { emoji: '' })
    await useCase.update('genre-31', { active: false })
    await useCase.update('genre-31', { featured: true })
    expect(repository.update.mock.calls).toEqual([['genre-31', { name: '사극' }], ['genre-31', { emoji: '' }], ['genre-31', { active: false }], ['genre-31', { featured: true }]])
  })

  it('이름을 비우거나 아이콘이 너무 길면 서버에 보내지 않고 안내를 던진다', async () => {
    const { repository, useCase } = setup()
    await expect(useCase.update('genre-31', { name: '  ' })).rejects.toBeInstanceOf(OperationsError)
    await expect(useCase.update('genre-31', { emoji: '123456789' })).rejects.toBeInstanceOf(OperationsError)
    expect(repository.update).not.toHaveBeenCalled()
  })
})

describe('운영 장르 순서·조회', () => {
  it('목록은 저장소 값을 그대로 돌려주고 순서는 전체 코드를 한 번에 보낸다', async () => {
    const { repository, useCase } = setup()
    await useCase.list()
    await useCase.reorder(['b', 'a'])
    expect(repository.list).toHaveBeenCalledTimes(1)
    expect(repository.reorder).toHaveBeenCalledWith(['b', 'a'])
  })
})

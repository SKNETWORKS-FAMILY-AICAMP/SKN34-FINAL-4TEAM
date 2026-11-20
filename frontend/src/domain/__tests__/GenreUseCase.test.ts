import { describe, expect, it, vi } from 'vitest'

import type { Genre } from '../entities/genre'
import type { GenreRepository } from '../repositories/GenreRepository'
import { GenreUseCase } from '../usecases/GenreUseCase'

describe('GenreUseCase', () => {
  it('공개 장르 목록을 저장소 순서 그대로 읽고 취소 신호를 넘기며 실패는 빈 목록으로 숨기지 않고 던진다', async () => {
    const genres: Genre[] = [{ code: 'genre-01', name: '판타지', emoji: '✨', featured: true }]
    const list = vi.fn<GenreRepository['list']>(async () => genres)
    const signal = new AbortController().signal
    expect(await new GenreUseCase({ list }).list(signal)).toBe(genres)
    expect(list).toHaveBeenCalledWith(signal)
    await expect(new GenreUseCase({ list: async () => { throw new Error('offline') } }).list()).rejects.toThrow('offline')
  })
})

import type { GenreRepository } from '../repositories/GenreRepository'

/** 작품·세계관 장르 선택지와 홈·검색 칩이 쓰는 공개 장르 목록(DEC-56). */
export class GenreUseCase {
  private readonly repository: GenreRepository
  constructor(repository: GenreRepository) { this.repository = repository }

  list(signal?: AbortSignal) { return this.repository.list(signal) }
}

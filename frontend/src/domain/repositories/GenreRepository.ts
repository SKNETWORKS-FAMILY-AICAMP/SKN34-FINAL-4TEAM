import type { Genre } from '../entities/genre'

/** 공개 장르 목록 계약(`GET /public/genres`, DEC-56). 익명도 읽는다. */
export interface GenreRepository {
  /** 활성 장르만, 표시 순서대로. 읽지 못하면 빈 목록으로 숨기지 않고 던진다. */
  list(signal?: AbortSignal): Promise<Genre[]>
}

import type { PublicWorld, PublicWorldGenre, PublicWorldPage } from '../entities/publicWorld'

export type PublicWorldQuery = { genre?: PublicWorldGenre; page: number; size: number }

/** 공개 세계관 읽기 계약([계약](../../../../docs/design/public-world-contract.md)). 서버 구현은 Content 공개 API이고 익명도 읽는다. */
export interface PublicWorldRepository {
  /** 공개 + 저장 버전이 있는 세계관, 공개 시각 최신 순. `genre`를 빼면 전체다. */
  list(query: PublicWorldQuery, signal?: AbortSignal): Promise<PublicWorldPage>
  /** 비공개·없는 세계관·저장 버전이 없는 세계관·형식이 틀린 id는 undefined다(서버는 404·400). 그 밖의 실패는 던진다. */
  get(id: string, signal?: AbortSignal): Promise<PublicWorld | undefined>
}

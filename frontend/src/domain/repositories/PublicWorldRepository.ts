import type { PublicWorld, PublicWorldCardPage, PublicWorldGenre, PublicWorldPage } from '../entities/publicWorld'

/** `q`는 이름·설명·작가에서 찾는 검색어다(#505). 없거나 공백이면 거르지 않는다. */
export type PublicWorldQuery = { genre?: PublicWorldGenre; q?: string; page: number; size: number }
export type PublicWorldCardQuery = { q: string; page: number; size: number }

/** 공개 세계관 읽기 계약([계약](../../../../docs/design/public-world-contract.md)). 서버 구현은 Content 공개 API이고 익명도 읽는다. */
export interface PublicWorldRepository {
  /** 공개 + 저장 버전이 있는 세계관, 공개 시각 최신 순. `genre`를 빼면 전체이고 `q`가 있으면 이름·설명·작가에 그 글자가 든 세계관만이다. */
  list(query: PublicWorldQuery, signal?: AbortSignal): Promise<PublicWorldPage>
  /** 비공개·없는 세계관·저장 버전이 없는 세계관·형식이 틀린 id는 undefined다(서버는 404·400). 그 밖의 실패는 던진다. */
  get(id: string, signal?: AbortSignal): Promise<PublicWorld | undefined>
  /** 공개 세계관의 독자에게 보이는 설정 카드를 제목·별칭·태그로 찾는다(#505, 본문 제외). 검색어는 필수이며 비면 서버가 거절해 던진다. */
  searchCards(query: PublicWorldCardQuery, signal?: AbortSignal): Promise<PublicWorldCardPage>
}

import type { SearchField, SearchSort, Work } from '../entities/work'

/** page(0부터)·size는 서버 페이지 구간이다. 둘 다 생략하면 서버가 전체를 돌려준다. */
export type WorkSearchQuery = { q: string; f: SearchField; sort: SearchSort; page?: number; size?: number }
export type WorkRankingKind = 'top' | 'rising'

/**
 * 공개 작품 검색·랭킹·조회 기록 계약(docs/design/work-search-ranking-contract.md).
 * 작품은 기존 카드 화면의 Work로 돌려주며, 서버에 없는 표시 값은 중립 기본값이다.
 */
export interface WorkSearchRepository {
  search(query: WorkSearchQuery, signal?: AbortSignal): Promise<Work[]>
  /** 최근 24시간 조회 기준 최대 10개. top은 조회 수, rising은 직전 24시간 대비 증가분 순이다. */
  ranking(kind: WorkRankingKind, signal?: AbortSignal): Promise<Work[]>
  /** 로그인 회원이 공개 회차를 연 기록. 익명이면 보내지 않으며, 같은 날 중복은 서버가 무시한다. */
  recordView(workId: string, episode: number, signal?: AbortSignal): Promise<void>
}

import type { RankingKind, RankingPeriod, RankingType, SearchField, SearchSort, Work } from '../entities/work'

export type WorkSearchQuery = { q: string; f: SearchField; sort: SearchSort }
/** 빠진 조건은 서버 기본값(기간 day·범위 all·10개)을 따른다. limit은 1~50. */
export type WorkRankingQuery = { kind: RankingKind; period?: RankingPeriod; type?: RankingType; limit?: number }

/**
 * 공개 작품 검색·랭킹·조회 기록 계약(docs/design/work-search-ranking-contract.md).
 * 작품은 기존 카드 화면의 Work로 돌려주며, 서버에 없는 표시 값은 중립 기본값이다.
 */
export interface WorkSearchRepository {
  search(query: WorkSearchQuery, signal?: AbortSignal): Promise<Work[]>
  /** 기간별 랭킹(기능표 45): 기준(조회·인기·급상승·최신·방금 업데이트)·기간·범위별 순위와 서버 계산 시각(화면의 "HH:mm 기준"). 방금 업데이트의 카드는 Work.upd에 지난 분을 담는다. */
  rankings(query: WorkRankingQuery, signal?: AbortSignal): Promise<{ items: Work[]; computedAt: Date }>
  /** 로그인 회원이 공개 회차를 연 기록. 익명이면 보내지 않으며, 같은 날 중복은 서버가 무시한다. */
  recordView(workId: string, episode: number, signal?: AbortSignal): Promise<void>
}

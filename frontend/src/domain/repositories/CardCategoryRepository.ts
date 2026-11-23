import type { CardCategory } from '../entities/cardCategory'

/** 공개 카드 카테고리 목록 계약(`GET /public/card-categories`). 익명도 읽는다. */
export interface CardCategoryRepository {
  /** 숨긴 것까지 모두(`active` 플래그), position 순서. 읽지 못하면 빈 목록으로 숨기지 않고 던진다. */
  list(signal?: AbortSignal): Promise<CardCategory[]>
}

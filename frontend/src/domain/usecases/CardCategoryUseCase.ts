import type { CardCategoryRepository } from '../repositories/CardCategoryRepository'

/** 카드 생성·수정 선택지와 분류 메뉴가 쓰는 공개 카드 카테고리 목록(숨김 포함, `active` 플래그). */
export class CardCategoryUseCase {
  private readonly repository: CardCategoryRepository
  constructor(repository: CardCategoryRepository) { this.repository = repository }

  list(signal?: AbortSignal) { return this.repository.list(signal) }
}

import type { CardCategoryInput, CardCategoryPatch, OperationsCardCategory } from '../entities/cardCategory'

/** 운영 카드 카테고리 관리 API 계약. 관리자 Bearer와 works 권한으로 호출하며, 변경 응답은 쓰지 않고 화면이 목록을 다시 읽는다. */
export interface OperationsCardCategoryRepository {
  /** 숨긴 카테고리를 포함한 전체(position 순)와 카드 수. */
  list(): Promise<OperationsCardCategory[]>
  create(input: CardCategoryInput): Promise<void>
  update(code: string, patch: CardCategoryPatch): Promise<void>
  /** 전체 코드를 한 번씩 담은 새 순서. 빠짐·중복·없는 코드는 서버가 거절한다. */
  reorder(codes: string[]): Promise<void>
}

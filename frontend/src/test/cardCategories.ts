import { vi } from 'vitest'

import { appContainer } from '../app/appContainer'
import { InMemoryCardCategoryRepository, InMemoryOperationsCardCategoryRepository } from '../data/mock/InMemoryCardCategoryRepositories'

/**
 * 렌더 테스트용: 운영 컨테이너의 공개 카드 카테고리 조회를 서버 없이 메모리 기본 8종으로 대신한다.
 * 목록을 읽지 못하면 화면이 기본 8종으로 대신하지 않고 실패 안내를 보이므로, 새 설정 메뉴·유형 선택을 쓰는 테스트는 이것을 먼저 부른다.
 * 되돌리는 일은 각 테스트의 afterEach(`vi.restoreAllMocks`)가 맡는다.
 */
export function stubCardCategories() {
  const repository = new InMemoryCardCategoryRepository(new InMemoryOperationsCardCategoryRepository())
  vi.spyOn(appContainer.resolve('cardCategoryUseCase'), 'list').mockImplementation(() => repository.list())
}

import { appContainer } from '../../app/appContainer'
import type { CardCategoryUseCase } from '../../domain/usecases/CardCategoryUseCase'
import { useAsyncData } from './useAsyncData'

/**
 * 카드 생성·수정 선택지와 이름이 쓰는 공개 카드 카테고리 목록(숨긴 것까지, `active` 플래그, 운영자 콘텐츠 관리 결정 E). 서버가 정본이다.
 * 읽는 동안·읽지 못했을 때는 `categories`가 없다: 기본 8종으로 대신하면 운영자가 숨기거나 더한 카테고리가 실제와 달라지므로, 쓰는 화면이
 * `isLoading`·`isError`·`retry`로 불러오는 중과 실패(다시 시도)를 보이고 선택은 잠근다(`useGenres`와 같은 규칙).
 * 다시 읽다 실패해도 앞서 읽은 목록이 있으면 그것을 그대로 쓴다.
 */
export function useCardCategories(useCase: CardCategoryUseCase = appContainer.resolve('cardCategoryUseCase')) {
  const { data, isLoading, isError, retry } = useAsyncData((signal) => useCase.list(signal), [useCase])
  return { categories: data, isLoading, isError: isError && !data, retry }
}

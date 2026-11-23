import { appContainer } from '../../app/appContainer'
import type { CardCategory } from '../../domain/entities/cardCategory'
import { cardTypes } from '../../domain/entities/studioCards'
import type { CardCategoryUseCase } from '../../domain/usecases/CardCategoryUseCase'
import { useAsyncData } from './useAsyncData'

/** 기본 8종(서버 목록을 읽기 전·읽지 못했을 때의 기준): 코드·이름은 `cardTypes`와 같고 모두 활성이다. */
const DEFAULTS: readonly CardCategory[] = cardTypes.map((type, i) => ({ code: type.id, name: type.label, icon: null, position: i + 1, active: true }))

/**
 * 카드 생성·수정 선택지와 이름이 쓰는 공개 카드 카테고리 목록(숨긴 것까지, `active` 플래그, 운영자 콘텐츠 관리 결정 E). 서버가 정본이다.
 * 아직 읽지 못했거나 읽지 못했을 때는 기본 8종으로 작업을 이어 간다 — 숨긴 카테고리를 골랐다면 서버가 저장할 때 422로 거절하고 그 사유를 화면이 보인다.
 */
export function useCardCategories(useCase: CardCategoryUseCase = appContainer.resolve('cardCategoryUseCase')) {
  const { data } = useAsyncData((signal) => useCase.list(signal), [useCase])
  return { categories: data ?? DEFAULTS }
}

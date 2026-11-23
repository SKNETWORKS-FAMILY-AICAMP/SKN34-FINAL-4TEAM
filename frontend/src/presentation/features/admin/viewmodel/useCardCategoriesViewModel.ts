import { appContainer } from '../../../../app/appContainer'
import type { CardCategoryInput, CardCategoryPatch, OperationsCardCategory } from '../../../../domain/entities/cardCategory'
import { moveCode } from '../../../../domain/entities/genre'
import type { OperationsCardCategoryUseCase } from '../../../../domain/usecases/OperationsCardCategoryUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

const quoted = (name: string) => `「${name}」`

/**
 * 카드 카테고리 관리(결정 E): 숨긴 카테고리를 포함한 전체와 카드 수를 읽고, 추가·이름·아이콘·숨김·순서 변경을 요청합니다. `카드 카테고리` 탭이 씁니다.
 * 변경 조치는 관리자 화면 공용 실행기(mutate)로 보내 진행·실패·완료 안내와 재조회를 한곳에서 합니다. 조치 키는 `cardCategory:new`·`cardCategory:<코드>`·`cardCategory:order`입니다.
 * 조회 권한(작품 관리)이 없으면 목록이 null이라 화면이 실패 대신 필요한 권한을 안내합니다.
 */
export function useCardCategoriesViewModel(mutate: AdminMutate, useCase: OperationsCardCategoryUseCase = appContainer.resolve('operationsCardCategoryUseCase')) {
  const categories = useAsyncData(() => useCase.list(), [useCase])
  return {
    categories,
    create: (input: CardCategoryInput) => mutate('cardCategory:new', `${quoted(input.name.trim())} 카테고리를 추가했어요.`, () => useCase.create(input)),
    /** `message`는 성공했을 때 그 카테고리 줄에 알릴 문구(조치마다 다르다). */
    update: (category: OperationsCardCategory, patch: CardCategoryPatch, message: string) => mutate(`cardCategory:${category.code}`, message, () => useCase.update(category.code, patch)),
    /** 현재 전체 코드 순서(`codes`)에서 한 칸 옮긴 순서를 저장한다. 더 옮길 수 없으면(맨 앞·맨 뒤) 보내지 않고 false다. */
    move: (codes: string[], category: OperationsCardCategory, delta: -1 | 1) => {
      const next = moveCode(codes, category.code, delta)
      return next ? mutate('cardCategory:order', `${quoted(category.name)} 카테고리를 ${delta < 0 ? '위로' : '아래로'} 옮겼어요.`, () => useCase.reorder(next)) : Promise.resolve(false)
    },
  }
}

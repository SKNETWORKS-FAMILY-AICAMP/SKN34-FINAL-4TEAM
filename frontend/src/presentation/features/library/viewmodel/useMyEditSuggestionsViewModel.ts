import { appContainer } from '../../../../app/appContainer'
import type { EditSuggestionUseCase } from '../../../../domain/usecases/EditSuggestionUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 내 서재의 내 수정 제안(기능 24). 상태 읽기 전용이라 서버 목록만 읽고, 실패를 빈 목록으로 숨기지 않습니다. */
export function useMyEditSuggestionsViewModel(useCase: EditSuggestionUseCase = appContainer.resolve('editSuggestionUseCase')) {
  const { data, isError, retry } = useAsyncData(() => useCase.mine(), [useCase])
  return { items: data, isError, retry }
}

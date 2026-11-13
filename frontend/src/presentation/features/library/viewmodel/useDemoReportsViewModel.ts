import { appContainer } from '../../../../app/appContainer'
import type { LibraryUseCase } from '../../../../domain/usecases/LibraryUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 데모 작품에 남긴 내 피드백(메모리). 서버 제보·제안은 각 ViewModel이 따로 읽는다. */
export function useDemoReportsViewModel(libraryUseCase: LibraryUseCase = appContainer.resolve('libraryUseCase')) {
  return useAsyncData(() => libraryUseCase.getReports(), [libraryUseCase]).data
}

import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 구형 slug 주소도 서버의 공개/소유 목록에서 확인한 UUID로 연결한다. */
export function useStudioRouteViewModel(id:string, useCase:ReadingUseCase=appContainer.resolve('readingUseCase')) {
  const role=useAppSelector(s=>s.session.role)
  return useAsyncData(()=>useCase.getWork(id,role),[useCase,id,role])
}

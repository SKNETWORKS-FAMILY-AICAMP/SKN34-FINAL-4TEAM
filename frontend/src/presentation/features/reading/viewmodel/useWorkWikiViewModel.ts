import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { useScreenId } from '../../../shared/screenIds'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * U45 설정 위키: 작품 상세와 같은 조회로 서버가 공개한 설정만 받는다. [upto]가 있으면 그 회차(회차 화면에서 온 경우), 없으면 최신 공개 회차 기준이다.
 */
export function useWorkWikiViewModel(id: string, upto?: number, readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const { data, isError, retry } = useAsyncData(() => readingUseCase.getWork(id, role, upto), [readingUseCase, id, role, upto])
  useScreenId(data ? 'U45' : null)
  return {
    /** undefined: 불러오는 중, null: 없거나 볼 수 없는 작품 */
    work: data && data.work,
    /** 실제로 적용된 기준 회차(1~마지막 회차로 맞춘 값) */
    upto: data ? data.upto : 0,
    isError, retry,
  }
}

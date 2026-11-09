import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import { epsOf } from '../../../../domain/entities/work'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { useScreenId } from '../../../shared/screenIds'
import { useAsyncData } from '../../../shared/useAsyncData'

/** U45 설정 위키: 작품 상세와 같은 조회(최신 공개 회차 기준 readWorld)로 서버가 공개한 설정만 받는다. */
export function useWorkWikiViewModel(id: string, readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const { data, isError, retry } = useAsyncData(() => readingUseCase.getWork(id, role), [readingUseCase, id, role])
  useScreenId(data ? 'U45' : null)
  return {
    /** undefined: 불러오는 중, null: 없거나 볼 수 없는 작품 */
    work: data && data.work,
    upto: data ? epsOf(data.work).length : 0,
    isError, retry,
  }
}

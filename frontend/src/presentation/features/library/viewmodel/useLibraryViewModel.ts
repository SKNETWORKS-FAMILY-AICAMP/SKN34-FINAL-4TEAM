import { useSearchParams } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import type { LibraryUseCase } from '../../../../domain/usecases/LibraryUseCase'
import { useAppDispatch } from '../../../../app/store'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 lib()·write()·libTabs: U11 내 서재, U12 내가 쓰는 소설 */
export function useLibraryViewModel(libraryUseCase: LibraryUseCase = appContainer.resolve('libraryUseCase')) {
  const [q] = useSearchParams()
  const dispatch = useAppDispatch()
  const tab = q.get('tab') === 'write' ? 'write' : q.get('tab') === 'qa' ? 'qa' : 'read'
  const { data } = useAsyncData(async () => ({
    tab,
    pending: await libraryUseCase.pending(),
    read: tab === 'read' ? await libraryUseCase.getRead() : null,
    reports: tab === 'qa' ? await libraryUseCase.getReports() : null,
    write: tab === 'write' ? await libraryUseCase.getWrite() : null,
  }), [libraryUseCase, tab])
  useScreenId(data ? (data.tab === 'write' ? 'U12' : 'U11') : null)
  /** 목업 data-appeal-form 제출 */
  const appeal = async (id: string, text: string) => { toast(await libraryUseCase.appeal(id, text)); dispatch(sessionActions.dataChanged()) }
  return data?.tab === tab ? { ...data, appeal } : undefined
}

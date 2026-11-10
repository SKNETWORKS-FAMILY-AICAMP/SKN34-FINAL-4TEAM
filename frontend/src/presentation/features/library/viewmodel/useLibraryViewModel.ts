import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import type { LibraryUseCase } from '../../../../domain/usecases/LibraryUseCase'
import type { PublishSettings, StudioUseCase } from '../../../../domain/usecases/StudioUseCase'
import { useAppDispatch } from '../../../../app/store'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 lib()·write()·libTabs: U11 내 서재, U12 내가 쓰는 소설 */
export function useLibraryViewModel(libraryUseCase: LibraryUseCase = appContainer.resolve('libraryUseCase'), studioUseCase: StudioUseCase = appContainer.resolve('studioUseCase')) {
  const [q] = useSearchParams()
  const dispatch = useAppDispatch()
  const tab = q.get('tab') === 'write' ? 'write' : q.get('tab') === 'qa' ? 'qa' : 'read'
  const { data, isError, retry } = useAsyncData(async () => ({
    tab,
    pending: await libraryUseCase.pending(),
    read: tab === 'read' ? await libraryUseCase.getRead() : null,
    reports: tab === 'qa' ? await libraryUseCase.getReports() : null,
    write: tab === 'write' ? await libraryUseCase.getWrite() : null,
  }), [libraryUseCase, tab])
  useScreenId(data ? (data.tab === 'write' ? 'U12' : 'U11') : null)
  /** 목업 data-appeal-form 제출 */
  const appeal = async (id: string, text: string) => { toast(await libraryUseCase.appeal(id, text)); dispatch(sessionActions.dataChanged()) }
  /** 목업 data-act="publish": 서재 위에 publishSheet(U21)를 띄우고 저장하면 서재에 머뭅니다. */
  const [publishId, setPublishId] = useState<string | null>(null)
  const savePublish = async (st: PublishSettings) => {
    try {
      const r = await studioUseCase.savePublishSettings(publishId!, st)
      toast('error' in r ? r.error : r.ok)
      if ('error' in r) return false
      dispatch(sessionActions.dataChanged())
      return true
    } catch(error) {
      toast(error instanceof Error ? error.message : '공개 설정을 저장하지 못했어요.')
      return false
    }
  }
  const publishing = data?.write?.mine.find((m) => m.work.id === publishId)?.work
  /** 서재 읽는 중 목록의 이어 읽기 기록 삭제. 진행 중에는 다른 삭제를 받지 않고, 실패는 안내하며 목록을 그대로 둡니다. */
  const [removing, setRemoving] = useState<string | null>(null)
  const removeBusy = useRef(false)
  const removeReading = async (workId: string) => {
    if (removeBusy.current) return
    removeBusy.current = true
    setRemoving(workId)
    try {
      await libraryUseCase.removeReading(workId)
      dispatch(sessionActions.dataChanged())
      toast('이어 읽기 기록을 지웠어요')
    } catch (error) {
      toast(error instanceof Error ? error.message : '이어 읽기 기록을 지우지 못했어요.')
    } finally {
      removeBusy.current = false
      setRemoving(null)
    }
  }
  return { data: data?.tab === tab ? { ...data, appeal, publishing, openPublish: setPublishId, closePublish: () => setPublishId(null), savePublish, removeReading, removing } : undefined, isError, retry }
}

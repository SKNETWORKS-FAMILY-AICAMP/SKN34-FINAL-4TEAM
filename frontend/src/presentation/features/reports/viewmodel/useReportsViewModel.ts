import { useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { OperationsError } from '../../../../domain/entities/operations'
import type { ReportUseCase } from '../../../../domain/usecases/ReportUseCase'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

type Action = { pending: boolean; error: string; message: string }
const idle: Action = { pending: false, error: '', message: '' }

/** 내 신고: 내가 신고했거나 내 작품이 대상인 신고와 증거 보완·소명. 역할 표시는 화면용이며 권한은 서버가 검사합니다. */
export function useReportsViewModel(useCase: ReportUseCase = appContainer.resolve('reportUseCase')) {
  const dispatch = useAppDispatch()
  const memberId = useAppSelector((s) => s.session.memberId)
  const [sel, setSel] = useState<string | null>(null)
  const [action, setAction] = useState<Action>(idle)
  const list = useAsyncData(() => useCase.listMine(), [useCase])
  const detail = useAsyncData(async () => sel ? useCase.get(sel) : null, [sel, useCase])
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const run = async (message: string, task: () => Promise<void>) => {
    if (busy.current) return false
    busy.current = true
    setAction({ ...idle, pending: true })
    try {
      await task()
      dispatch(sessionActions.dataChanged())
      if (mounted.current) setAction({ ...idle, message })
      return true
    } catch (error) {
      if (mounted.current) setAction({ ...idle, error: error instanceof OperationsError ? error.message : '완료 여부를 확인하지 못했어요. 새로고침해 처리 여부를 확인한 뒤 다시 시도해 주세요.' })
      return false
    } finally { busy.current = false }
  }
  const report = detail.data && detail.data.id === sel ? detail.data : null
  return {
    list, detail, report, sel, action, memberId,
    isReporter: !!report && report.reporterId === memberId,
    isOwner: !!report && report.workOwnerId === memberId,
    select: (id: string | null) => { setSel(id); setAction(idle) },
    addEvidence: (id: string, body: string) => run('증거를 보완했어요.', () => useCase.addEvidence(id, body)),
    addExplanation: (id: string, body: string) => run('소명을 제출했어요.', () => useCase.addExplanation(id, body)),
  }
}

import { useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../app/appContainer'
import { OperationsError } from '../../../domain/entities/operations'
import type { ReportKind } from '../../../domain/entities/report'
import type { ReportUseCase } from '../../../domain/usecases/ReportUseCase'

type State = { pending: boolean; error: string; done: boolean }
const idle: State = { pending: false, error: '', done: false }

/** 공개 작품 신고 접수. 서버 201 응답만 접수 완료로 표시하고, 실패하면 입력을 유지합니다. */
export function useReportWorkViewModel(workId: string, useCase: ReportUseCase = appContainer.resolve('reportUseCase')) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<State>(idle)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const submit = async (kind: ReportKind, reason: string, evidence: string) => {
    if (busy.current) return false
    busy.current = true
    setState({ ...idle, pending: true })
    try {
      await useCase.submit({ kind, workId, reason, evidence })
      if (mounted.current) setState({ ...idle, done: true })
      return true
    } catch (error) {
      if (mounted.current) setState({ ...idle, error: error instanceof OperationsError ? error.message : '접수 여부를 확인하지 못했어요. 내 신고 목록에서 확인한 뒤 다시 시도해 주세요.' })
      return false
    } finally { busy.current = false }
  }
  return { open, ...state, toggle: () => { setOpen((v) => !v); setState(idle) }, submit }
}

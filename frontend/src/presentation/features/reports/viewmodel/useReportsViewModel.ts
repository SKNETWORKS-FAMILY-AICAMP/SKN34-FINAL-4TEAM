import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import type { ReportUseCase } from '../../../../domain/usecases/ReportUseCase'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { idleAction, useActionRunner } from '../../../shared/useActionRunner'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 내 신고: 내가 신고했거나 내 작품이 대상인 신고와 증거 보완·소명. 역할 표시는 화면용이며 권한은 서버가 검사합니다. */
export function useReportsViewModel(useCase: ReportUseCase = appContainer.resolve('reportUseCase')) {
  const dispatch = useAppDispatch()
  const memberId = useAppSelector((s) => s.session.memberId)
  const [sel, setSel] = useState<string | null>(null)
  const { actions, run: exec, reset } = useActionRunner('완료 여부를 확인하지 못했어요. 새로고침해 처리 여부를 확인한 뒤 다시 시도해 주세요.')
  const list = useAsyncData(() => useCase.listMine(), [useCase])
  const detail = useAsyncData(async () => sel ? useCase.get(sel) : null, [sel, useCase])

  // 증거 보완·소명은 한 번에 하나만 보내므로 같은 key를 씁니다.
  const run = (msg: string, task: () => Promise<void>) => exec('action', async () => {
    await task()
    dispatch(sessionActions.dataChanged())
    return { ok: true, msg }
  })
  const report = detail.data && detail.data.id === sel ? detail.data : null
  return {
    list, detail, report, sel, action: actions.action ?? idleAction, memberId,
    isReporter: !!report && report.reporterId === memberId,
    isOwner: !!report && report.workOwnerId === memberId,
    select: (id: string | null) => { setSel(id); reset() },
    addEvidence: (id: string, body: string) => run('증거를 보완했어요.', () => useCase.addEvidence(id, body)),
    addExplanation: (id: string, body: string) => run('소명을 제출했어요.', () => useCase.addExplanation(id, body)),
  }
}

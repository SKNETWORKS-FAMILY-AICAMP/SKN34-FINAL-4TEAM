import { useState } from 'react'

import { appContainer } from '../../../app/appContainer'
import type { ReportKind } from '../../../domain/entities/report'
import type { ReportUseCase } from '../../../domain/usecases/ReportUseCase'
import { idleAction, useActionRunner } from '../useActionRunner'

/** 공개 작품 신고 접수. 서버 201 응답만 접수 완료로 표시하고, 실패하면 입력을 유지합니다. */
export function useReportWorkViewModel(workId: string, useCase: ReportUseCase = appContainer.resolve('reportUseCase')) {
  const [open, setOpen] = useState(false)
  const { actions, run, reset } = useActionRunner('접수 여부를 확인하지 못했어요. 내 신고 목록에서 확인한 뒤 다시 시도해 주세요.')
  const { pending, error, message } = actions.submit ?? idleAction

  const submit = (kind: ReportKind, reason: string, evidence: string) => run('submit', async () => {
    await useCase.submit({ kind, workId, reason, evidence })
    return { ok: true, msg: '신고를 접수했어요.' } // View가 링크와 함께 문구를 직접 보여 주므로 done 표시에만 씁니다.
  })
  return { open, pending, error, done: !!message, toggle: () => { setOpen((v) => !v); reset() }, submit }
}

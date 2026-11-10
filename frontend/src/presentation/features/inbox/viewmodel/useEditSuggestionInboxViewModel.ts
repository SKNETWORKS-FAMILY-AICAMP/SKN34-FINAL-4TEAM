import { useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { approvalNotice, type EditSuggestion } from '../../../../domain/entities/editSuggestion'
import type { EditSuggestionUseCase } from '../../../../domain/usecases/EditSuggestionUseCase'
import { toast } from '../../../shared/events'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 작가 피드백함의 실제 작품 수정 제안(기능 24). 목록은 서버에서 읽고, 처리는 한 번에 하나만 보낸 뒤 서버 값으로 다시 읽습니다.
 * 처리 실패(기준 발행본 변경 409 포함)는 서버 문구를 그 제안 옆에 알리고 목록을 다시 읽어 실제 상태를 보입니다.
 */
export function useEditSuggestionInboxViewModel(useCase: EditSuggestionUseCase = appContainer.resolve('editSuggestionUseCase')) {
  const { data, isError, retry } = useAsyncData(() => useCase.inbox(), [useCase])
  const busy = useRef(false)
  const [pending, setPending] = useState<string | null>(null)
  /** 처리 결과 안내. 어느 제안의 결과인지 함께 보관하고 ok=false는 실패 안내입니다. */
  const [notice, setNotice] = useState<{ id: string; msg: string; ok: boolean } | null>(null)

  /** 성공하면 true. 이미 처리 중이면 무시합니다. */
  const run = async (s: EditSuggestion, task: () => Promise<EditSuggestion>, done: (result: EditSuggestion) => string) => {
    if (busy.current) return false
    busy.current = true
    setPending(s.id)
    setNotice(null)
    try {
      const msg = done(await task())
      setNotice({ id: s.id, msg, ok: true })
      toast(msg)
      return true
    } catch (error) {
      setNotice({ id: s.id, msg: error instanceof Error ? error.message : '요청을 처리하지 못했어요.', ok: false })
      return false
    } finally {
      busy.current = false
      setPending(null)
      retry()
    }
  }

  return {
    items: data, isError, retry, pending, notice,
    saveEditedText: (s: EditSuggestion, text: string) => run(s, () => useCase.saveEditedText(s, text), () => '편집안을 저장했어요. 승인하면 이 문장이 반영돼요.'),
    approve: (s: EditSuggestion) => run(s, () => useCase.approve(s), approvalNotice),
    reject: (s: EditSuggestion, reason: string) => run(s, () => useCase.reject(s, reason), () => '거절했어요.'),
    hold: (s: EditSuggestion) => run(s, () => useCase.hold(s), () => '보류했어요. 나중에 다시 검토할 수 있어요.'),
  }
}

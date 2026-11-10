import { useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { EditSuggestionUseCase } from '../../../../domain/usecases/EditSuggestionUseCase'
import { toast } from '../../../shared/events'

/**
 * 실제 작품 문장 수정 제안 보내기(기능 24). 한 번에 하나만 보내고, 입력 거절·서버 거절·네트워크 실패는 안내만 하며 입력은 호출 측이 그대로 둡니다.
 * 보낸 제안은 되돌릴 수 없어 화면을 떠나도 취소하지 않고 결과를 안내합니다.
 */
export function useEditSuggestionViewModel(workId: string, n: number, useCase: EditSuggestionUseCase = appContainer.resolve('editSuggestionUseCase')) {
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
  return {
    busy,
    /** 성공하면 true. 이미 보내는 중이면 무시합니다. */
    propose: async (beforeText: string, afterText: string, reason: string) => {
      if (sending.current) return false
      sending.current = true
      setBusy(true)
      try {
        await useCase.propose(workId, n, { beforeText, afterText, reason })
        toast('수정 제안을 보냈어요. 작가가 승인해야 원고에 반영되고, 상태는 내 서재에서 볼 수 있어요.')
        return true
      } catch (error) {
        toast(error instanceof Error ? error.message : '수정 제안을 보내지 못했어요.')
        return false
      } finally {
        sending.current = false
        setBusy(false)
      }
    },
  }
}

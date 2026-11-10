import { useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { EditSuggestionUseCase } from '../../../../domain/usecases/EditSuggestionUseCase'
import { toast } from '../../../shared/events'

/**
 * 실제 작품 문장 수정 제안 보내기(기능 24). 한 번에 하나만 보내고, 입력 거절·서버 거절·네트워크 실패는 안내만 하며 입력은 호출 측이 그대로 둡니다.
 * 보낸 제안은 되돌릴 수 없어 화면을 떠나도 취소하지 않고 결과를 안내합니다. 실패는 시트가 열려 있으면 시트 안에서만, 이미 닫았으면 토스트로 알립니다.
 */
export function useEditSuggestionViewModel(workId: string, n: number, useCase: EditSuggestionUseCase = appContainer.resolve('editSuggestionUseCase')) {
  const sending = useRef(false)
  // 이 Hook을 쓰는 시트가 화면에 있는 동안만 true입니다. 실패 안내를 시트 안과 토스트 중 어디에 줄지 정합니다.
  const open = useRef(true)
  useEffect(() => { open.current = true; return () => { open.current = false } }, [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return {
    busy,
    /** 마지막 전송이 거절·실패한 이유. 시트 안에 알리고 다음 전송을 시작하면 지웁니다. */
    error,
    /** 성공하면 true. 이미 보내는 중이면 무시합니다. */
    propose: async (beforeText: string, afterText: string, reason: string) => {
      if (sending.current) return false
      sending.current = true
      setBusy(true)
      setError(null)
      try {
        await useCase.propose(workId, n, { beforeText, afterText, reason })
        toast('수정 제안을 보냈어요. 작가가 승인해야 원고에 반영되고, 상태는 내 서재에서 볼 수 있어요.')
        return true
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : '수정 제안을 보내지 못했어요.'
        if (open.current) setError(message)
        else toast(message)
        return false
      } finally {
        sending.current = false
        setBusy(false)
      }
    },
  }
}

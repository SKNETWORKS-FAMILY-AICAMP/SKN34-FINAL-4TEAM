import { useEffect, useRef, useState } from 'react'

import { toast } from '../../../shared/events'

/**
 * 시트 안에서 보낸 요청의 실패 사유를 어디에 알릴지 정합니다. 이 Hook을 쓰는 시트가 떠 있는 동안은 시트 안(`error`)에 남겨
 * 사용자가 고칠 때까지 보이게 하고, 이미 닫았으면 토스트로 알립니다(보낸 요청은 화면을 떠나도 취소하지 않습니다).
 */
export function useInlineFailure() {
  const open = useRef(true)
  useEffect(() => { open.current = true; return () => { open.current = false } }, [])
  const [error, setError] = useState<string | null>(null)
  return {
    /** 마지막 요청이 거절·실패한 이유. 다음 요청을 시작할 때 `clear`로 지웁니다. */
    error,
    clear: () => setError(null),
    fail: (message: string) => { if (open.current) setError(message); else toast(message) },
  }
}

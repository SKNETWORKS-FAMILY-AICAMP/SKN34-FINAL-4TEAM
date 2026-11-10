import { useRef, useState } from 'react'

import { toast } from '../events'

/**
 * 제보 쓰기 실행기: 한 번에 하나만 보내고(진행 중이면 무시), 성공하면 목록을 다시 읽은 뒤 완료를 안내하고,
 * 입력 거절·서버 거절·네트워크 실패는 안내만 합니다(입력은 호출 측이 그대로 둡니다). 성공하면 true입니다.
 * 쓰기는 보낸 뒤 되돌릴 수 없어 화면을 떠나도 취소하지 않고 결과를 안내합니다.
 */
export function useReportSender(reload: () => void) {
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const send = async (task: () => Promise<unknown>, done: string) => {
    if (sending.current) return false
    sending.current = true
    setBusy(true)
    try {
      await task()
      reload()
      toast(done)
      return true
    } catch (error) {
      toast(error instanceof Error ? error.message : '제보 요청을 처리하지 못했어요.')
      return false
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return { busy, send }
}

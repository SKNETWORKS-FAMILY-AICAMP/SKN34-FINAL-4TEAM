import { useRef, useState } from 'react'

import { toast } from '../events'

/**
 * 제보 쓰기 실행기: 한 번에 하나만 보내고(진행 중이면 무시), 성공하면 목록을 다시 읽은 뒤 완료를 안내하고,
 * 입력 거절·서버 거절·네트워크 실패는 안내만 합니다(입력은 호출 측이 그대로 둡니다). 성공하면 true입니다.
 * 쓰기는 보낸 뒤 되돌릴 수 없어 화면을 떠나도 취소하지 않고 결과를 안내합니다.
 * 토스트는 곧 사라지므로 마지막 결과를 notice로도 남깁니다. send에 대상(key, 예: 제보 id)을 주면 화면이 그 행 안에 결과를 둘 수 있고,
 * 새 요청을 보내면 이전 결과는 지웁니다.
 */
export function useReportSender(reload: () => void) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ key?: string; ok: boolean; msg: string } | null>(null)
  const sending = useRef(false)
  const send = async (task: () => Promise<unknown>, done: string, key?: string) => {
    if (sending.current) return false
    sending.current = true
    setBusy(true)
    setNotice(null)
    const tell = (ok: boolean, msg: string) => { setNotice({ key, ok, msg }); toast(msg) }
    try {
      await task()
      reload()
      tell(true, done)
      return true
    } catch (error) {
      tell(false, error instanceof Error ? error.message : '제보 요청을 처리하지 못했어요.')
      return false
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return { busy, send, notice }
}

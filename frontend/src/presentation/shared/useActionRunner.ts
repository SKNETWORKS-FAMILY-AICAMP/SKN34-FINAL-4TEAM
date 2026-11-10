import { useRef, useState } from 'react'

import { OperationsError } from '../../domain/entities/operations'

export type ActionState = { pending: boolean; error: string; message: string }
export const idleAction: ActionState = { pending: false, error: '', message: '' }

/**
 * 조치 실행기: key별 중복 실행 방지와 pending·오류·완료 문구 상태를 맡습니다.
 * task가 ok 결과를 돌려주면 msg를 완료 문구로, 아니면 msg를 오류로 보여 줍니다. 던지면 OperationsError 문구
 * (그 밖의 예외는 fallbackError)를 오류로 보여 주고 onError로도 알립니다. 진행 중인 key는 실행하지 않고 false입니다.
 * 재조회·알림 같은 화면별 후처리는 호출부가 task 안에서 합니다.
 */
export function useActionRunner(fallbackError: string, onError?: (message: string) => void) {
  const busy = useRef(new Set<string>())
  const [actions, setActions] = useState<Record<string, ActionState>>({})
  const show = (key: string, state: ActionState) => setActions((s) => ({ ...s, [key]: state }))

  const run = async (key: string, task: () => Promise<{ ok: boolean; msg: string }>) => {
    if (busy.current.has(key)) return false
    busy.current.add(key)
    show(key, { ...idleAction, pending: true })
    try {
      const { ok, msg } = await task()
      show(key, ok ? { ...idleAction, message: msg } : { ...idleAction, error: msg })
      return ok
    } catch (error) {
      const message = error instanceof OperationsError ? error.message : fallbackError
      show(key, { ...idleAction, error: message })
      onError?.(message)
      return false
    } finally { busy.current.delete(key) }
  }
  return { actions, run, reset: () => setActions({}) }
}

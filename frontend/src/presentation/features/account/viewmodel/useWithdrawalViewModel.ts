import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch } from '../../../../app/store'
import type { WithdrawalState } from '../../../../domain/entities/withdrawal'
import { SessionExpired } from '../../../../domain/repositories/ProfileRepository'
import { WithdrawalConflict, WithdrawalWrongPassword } from '../../../../domain/repositories/WithdrawalRepository'
import { WithdrawalInputError } from '../../../../domain/usecases/WithdrawalUseCase'
import { toast } from '../../../shared/events'
import { sessionActions } from '../../../shared/session/sessionSlice'

/** 계정 > 프로필의 회원탈퇴 카드. 상태를 읽고, 유예 탈퇴 요청과 유예 중 복구를 처리합니다. */
export function useWithdrawalViewModel() {
  const withdrawal = appContainer.resolve('withdrawalUseCase')
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const focusHandled = useCallback(() => setParams((current) => { const next = new URLSearchParams(current); next.delete('focus'); return next }, { replace: true }), [setParams])
  const busy = useRef(false)
  const [state, setState] = useState<WithdrawalState | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [expiredByServer, setExpiredByServer] = useState(false)
  const mutation = useRef<AbortController | null>(null)
  // 화면을 떠나면 진행 중인 요청·복구를 취소해, 늦은 응답이 다른 화면이나 다른 세션을 바꾸지 않게 합니다.
  useEffect(() => () => mutation.current?.abort(), [])

  useEffect(() => {
    const request = new AbortController()
    setState(null)
    setLoadError(false)
    withdrawal.status(request.signal).then((result) => { if (!request.signal.aborted) setState(result) }).catch((reason: unknown) => {
      if (request.signal.aborted) return
      if (reason instanceof SessionExpired) dispatch(sessionActions.logout())
      else setLoadError(true)
    })
    return () => request.abort()
  }, [withdrawal, dispatch, attempt])

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (busy.current) return false
    const controller = new AbortController()
    mutation.current = controller
    busy.current = true; setPending(true); setError('')
    try {
      await action(controller.signal)
      return true
    } catch (reason) {
      if (controller.signal.aborted) return false
      if (reason instanceof SessionExpired) dispatch(sessionActions.logout())
      else if (reason instanceof WithdrawalWrongPassword) setError('비밀번호가 맞지 않아요.')
      else if (reason instanceof WithdrawalConflict && state?.status === 'PENDING') { setExpiredByServer(true); setError('유예 기간이 지나 복구할 수 없어요.') }
      else if (reason instanceof WithdrawalConflict) {
        // 다른 탭 등에서 이미 요청했으면 최신 상태(유예 중)를 다시 읽어 보여 줍니다.
        setError('이미 진행 중인 탈퇴 요청이 있어요.')
        setAttempt((value) => value + 1)
      }
      else if (reason instanceof WithdrawalInputError) setError(reason.message)
      else setError('요청을 처리하지 못했어요. 다시 시도해 주세요.')
      return false
    } finally { busy.current = false; setPending(false) }
  }

  return {
    state, loadError, pending, error,
    /** 탈퇴 요청 알림에서 왔으면(`?focus=withdrawal`) 카드가 상태를 그린 뒤 한 번만 스크롤·포커스합니다. */
    focusRequested: params.get('focus') === 'withdrawal',
    /** 포커스를 옮긴 뒤 표시를 지워, 새로 고침이나 상태 갱신 때 다시 끌어당기지 않습니다. */
    focusHandled,
    /** 유예 기한이 지났으면(서버 409 또는 기한 시각 경과) 복구 요청을 보내지 않습니다. */
    expired: expiredByServer || (state?.status === 'PENDING' && Date.parse(state.dueAt) <= Date.now()),
    retry: () => setAttempt((value) => value + 1),
    clearError: () => setError(''),
    /** 요청이 받아지면 서버가 모든 세션을 끊으므로 로그아웃 상태로 홈에 돌아갑니다. */
    request: (password: string, reason: string) => run(async (signal) => {
      await withdrawal.request(password, reason, signal)
      dispatch(sessionActions.logout())
      navigate('/')
      toast('탈퇴를 요청했어요. 30일 안에 다시 로그인해 탈퇴 요청을 취소하면 복구할 수 있어요.')
    }),
    restore: () => run(async (signal) => {
      await withdrawal.restore(signal)
      setState({ status: 'NONE' })
      toast('탈퇴 요청을 취소했어요. 계정을 그대로 쓸 수 있어요.')
    }),
  }
}

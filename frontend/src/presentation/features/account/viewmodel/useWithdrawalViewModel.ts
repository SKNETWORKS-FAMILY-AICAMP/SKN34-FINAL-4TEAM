import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch } from '../../../../app/store'
import type { WithdrawalState } from '../../../../domain/entities/withdrawal'
import { SessionExpired } from '../../../../domain/repositories/ProfileRepository'
import { WithdrawalConflict, WithdrawalWrongPassword } from '../../../../domain/repositories/WithdrawalRepository'
import { toast } from '../../../shared/events'
import { sessionActions } from '../../../shared/session/sessionSlice'

/** 계정 > 프로필의 회원탈퇴 카드. 상태를 읽고, 유예 탈퇴 요청과 유예 중 복구를 처리합니다. */
export function useWithdrawalViewModel() {
  const withdrawal = appContainer.resolve('withdrawalUseCase')
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const busy = useRef(false)
  const [state, setState] = useState<WithdrawalState | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

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

  async function run(action: () => Promise<void>) {
    if (busy.current) return false
    busy.current = true; setPending(true); setError('')
    try {
      await action()
      return true
    } catch (reason) {
      if (reason instanceof SessionExpired) dispatch(sessionActions.logout())
      else if (reason instanceof WithdrawalWrongPassword) setError('비밀번호가 맞지 않아요.')
      else if (reason instanceof WithdrawalConflict) setError(state?.status === 'PENDING' ? '유예 기간이 지나 복구할 수 없어요.' : '이미 진행 중인 탈퇴 요청이 있어요. 새로고침해 주세요.')
      else setError(reason instanceof Error && reason.message ? reason.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.')
      return false
    } finally { busy.current = false; setPending(false) }
  }

  return {
    state, loadError, pending, error,
    retry: () => setAttempt((value) => value + 1),
    clearError: () => setError(''),
    /** 요청이 받아지면 서버가 모든 세션을 끊으므로 로그아웃 상태로 홈에 돌아갑니다. */
    request: (password: string, reason: string) => run(async () => {
      await withdrawal.request(password, reason)
      dispatch(sessionActions.logout())
      navigate('/')
      toast('탈퇴를 요청했어요. 30일 안에 다시 로그인하면 복구할 수 있어요.')
    }),
    restore: () => run(async () => {
      await withdrawal.restore()
      setState({ status: 'NONE' })
      toast('탈퇴 요청을 취소했어요. 계정을 그대로 쓸 수 있어요.')
    }),
  }
}

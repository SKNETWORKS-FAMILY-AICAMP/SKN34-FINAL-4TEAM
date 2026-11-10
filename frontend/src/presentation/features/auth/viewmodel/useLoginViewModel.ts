import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { EMAIL } from '../../../../domain/entities/account'
import { AccountRestricted, InvalidCredentials, LockUnavailable } from '../../../../domain/repositories/AuthRepository'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'

export function useLoginViewModel() {
  useScreenId('L01')
  const { loginMsg, next } = useAppSelector((s) => s.session)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  /** 오류가 입력한 이메일·비밀번호 때문일 때만 참입니다. 서버·잠금 장애는 입력을 탓하지 않습니다. */
  const [invalid, setInvalid] = useState(false)
  const busy = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const submit = async (email: string, password: string) => {
    if (busy.current) return
    if (!EMAIL.test(email) || !password) { setError('이메일과 비밀번호를 확인해 주세요.'); setInvalid(true); return }
    busy.current = true
    setPending(true)
    setError('')
    setInvalid(false)
    try {
      const user = await appContainer.resolve('authUseCase').login(email, password)
      if (!active.current) return
      dispatch(sessionActions.login(user))
      navigate(next && next !== '/login' && (!next.startsWith('/admin') || user.operator) ? next : '/')
    } catch (cause) {
      if (!active.current) return
      setInvalid(cause instanceof InvalidCredentials)
      setError(cause instanceof LockUnavailable
        ? cause.message === 'Browser lock busy'
          ? '다른 탭에서 인증을 처리하고 있어요. 잠시 후 다시 시도해 주세요.'
          : '브라우저에서 인증을 안전하게 처리할 수 없어요. 브라우저 설정을 확인하거나 다른 브라우저를 사용해 주세요.'
        : cause instanceof InvalidCredentials
          ? '로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.'
          : cause instanceof AccountRestricted
            ? "이용이 제한된 계정이에요. 문의가 필요하면 아래 '로그인 문의'로 연락해 주세요."
            : '로그인 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      busy.current = false
      if (active.current) setPending(false)
    }
  }
  return { loginMsg, pending, error, invalid, submit }
}

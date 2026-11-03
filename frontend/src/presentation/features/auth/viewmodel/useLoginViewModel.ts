import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { EMAIL } from '../../../../domain/entities/account'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'

export function useLoginViewModel() {
  useScreenId('L01')
  const { loginMsg, next } = useAppSelector((s) => s.session)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const submit = async (email: string, password: string) => {
    if (busy.current) return
    if (!EMAIL.test(email) || !password) { setError('이메일과 비밀번호를 확인해 주세요.'); return }
    busy.current = true
    setPending(true)
    setError('')
    try {
      const user = await appContainer.resolve('authUseCase').login(email, password)
      if (!active.current) return
      dispatch(sessionActions.login(user))
      navigate(next && next !== '/login' && (!next.startsWith('/admin') || user.operator) ? next : '/')
    } catch {
      if (active.current) setError('로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.')
    } finally {
      busy.current = false
      if (active.current) setPending(false)
    }
  }
  return { loginMsg, pending, error, submit }
}

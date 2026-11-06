import { useNavigate } from 'react-router'

import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { EMAIL } from '../../../../domain/entities/account'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'


/** 목업 login()·doLogin(): 실제 인증 없이 데모 역할만 정합니다. */
export function useLoginViewModel() {
  useScreenId('L01')
  const { loginRole, loginMsg, next } = useAppSelector((s) => s.session)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const enter = (email?: string) => {
    const to = loginRole === 'admin' ? '/admin' : next && !next.startsWith('/admin') && next !== '/login' ? next : '/'
    dispatch(sessionActions.login({ email }))
    toast(loginRole === 'admin' ? '관리자로 로그인했어요 (데모)' : '로그인했어요 (데모)')
    navigate(to)
  }
  return {
    loginRole,
    loginMsg,
    setRole: (r: 'user' | 'admin') => dispatch(sessionActions.setLoginRole(r)),
    demoLogin: () => enter(),
    /** 입력값은 저장·전송하지 않고 형식만 확인합니다. 성공하면 true */
    submit: (email: string, password: string) => {
      if (!email || !password) return toast('이메일과 비밀번호를 입력해 주세요. 데모 계정 버튼으로 바로 시작할 수도 있어요'), false
      if (!EMAIL.test(email)) return toast('이메일 형식을 확인해 주세요'), false
      enter(loginRole === 'user' ? email : undefined)
      return true
    },
  }
}

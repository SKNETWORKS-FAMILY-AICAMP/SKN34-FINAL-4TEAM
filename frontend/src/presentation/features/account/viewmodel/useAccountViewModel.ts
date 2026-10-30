import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { checkProfile, checkSignup } from '../../../../domain/entities/account'
import type { AccountUseCase } from '../../../../domain/usecases/AccountUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 mePage(sub)·saveProfile·#suf·#iqf·withdrawSheet: U30~U35E 계정 */
export function useAccountViewModel(sub: string, accountUseCase: AccountUseCase = appContainer.resolve('accountUseCase')) {
  const { role, user, next } = useAppSelector((s) => s.session)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  useScreenId(sub === 'signup' ? 'U31' : sub === 'liked' ? 'U32' : sub === 'pay' ? 'U33' : sub === 'inquiry' ? 'U34' : sub === 'notice' ? 'U35' : sub === 'event' ? 'U35E' : 'U30')
  const { data } = useAsyncData(async () => ({
    sub,
    liked: sub === 'liked' ? await accountUseCase.liked() : [],
    storage: sub === 'storage' ? await accountUseCase.storage() : null,
    inquiries: sub === 'inquiry' ? await accountUseCase.inquiries() : [],
    board: sub === 'notice' || sub === 'event' ? await accountUseCase.board() : null,
  }), [accountUseCase, sub])
  return {
    role, user, data: data?.sub === sub ? data : undefined,
    saveProfile: (nick: string, email: string) => {
      const err = checkProfile(nick, email)
      if (err) { toast(err); return false }
      dispatch(sessionActions.setUser({ nick: nick.trim(), email: email.trim() }))
      toast('프로필을 저장했어요')
      return true
    },
    signup: (o: Parameters<typeof checkSignup>[0]) => {
      const err = checkSignup(o)
      if (err) { toast(err); return false }
      const nick = o.nick.trim()
      dispatch(sessionActions.setUser({ nick, email: o.email.trim(), joined: '2026.10.27' }))
      dispatch(sessionActions.setLoginRole('user'))
      dispatch(sessionActions.login({}))
      toast('가입을 환영해요, ' + nick + '님')
      navigate(next && !next.startsWith('/admin') && next !== '/login' ? next : '/')
      return true
    },
    ask: async (t: string, s: string, b: string) => {
      const msg = await accountUseCase.ask(t, s, b)
      toast(msg)
      if (msg.startsWith('문의를 보냈어요')) { dispatch(sessionActions.dataChanged()); return true }
      return false
    },
  }
}

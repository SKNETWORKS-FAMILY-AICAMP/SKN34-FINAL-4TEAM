import { useRef } from 'react'
import { useNavigate } from 'react-router'
import { appContainer } from '../../../app/appContainer'
import { useAppDispatch } from '../../../app/store'
import { SessionExpired } from '../../../domain/repositories/ProfileRepository'
import { toast } from '../events'
import { sessionActions } from './sessionSlice'

export function useLogout() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const busy = useRef(false)
  return async () => {
    if (busy.current) return
    busy.current = true
    try {
      await appContainer.resolve('authUseCase').logout()
      dispatch(sessionActions.logout())
      navigate('/')
      toast('로그아웃했어요')
      return true
    } catch (error) {
      if (error instanceof SessionExpired) {
        dispatch(sessionActions.logout())
        navigate('/login')
        toast('세션이 만료됐어요. 다시 로그인해 주세요.')
        return true
      }
      toast('로그아웃하지 못했어요. 다시 시도해 주세요.')
      return false
    } finally {
      busy.current = false
    }
  }
}

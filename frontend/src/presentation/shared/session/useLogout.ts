import { useContext, useRef } from 'react'
import { useNavigate } from 'react-router'
import { appContainer } from '../../../app/appContainer'
import { useAppDispatch } from '../../../app/store'
import type { AuthUseCase } from '../../../domain/usecases/AuthUseCase'
import { WorldStudioLeaveContext } from '../../features/worldstudio/viewmodel/worldStudioLeaveGuard'
import { toast } from '../events'
import { sessionActions } from './sessionSlice'
import { logoutSession } from './logoutSession'

export function useLogout(auth: Pick<AuthUseCase, 'logout'> = appContainer.resolve('authUseCase')) {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const busy = useRef(false)
  const guard = useContext(WorldStudioLeaveContext)
  return async () => {
    if (busy.current) return
    busy.current = true
    try {
      return await logoutSession({
        logout: () => auth.logout(),
        clearSession: () => dispatch(sessionActions.logout()),
        navigate,
        notify: toast,
        guard,
      })
    } finally {
      busy.current = false
    }
  }
}

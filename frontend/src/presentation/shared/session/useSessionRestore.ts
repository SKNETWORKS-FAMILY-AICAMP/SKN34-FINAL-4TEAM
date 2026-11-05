import { useEffect, useState } from 'react'
import { appContainer } from '../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../app/store'
import { LockUnavailable } from '../../../domain/repositories/AuthRepository'
import { SessionExpired } from '../../../domain/repositories/ProfileRepository'
import { sessionActions } from './sessionSlice'

export function useSessionRestore() {
  const dispatch = useAppDispatch()
  const user = useAppSelector((s) => s.session.user)
  const [restoring, setRestoring] = useState(true)
  const [restoreError, setRestoreError] = useState<'lock' | 'connection' | null>(null)
  useEffect(() => { setRestoreError(null) }, [user])
  useEffect(() => {
    let active = true
    appContainer.resolve('authUseCase').refresh().then((user) => {
      if (active) dispatch(sessionActions.login(user))
    }).catch((error: unknown) => {
      if (!active) return
      if (error instanceof LockUnavailable) setRestoreError('lock')
      else if (error instanceof SessionExpired) dispatch(sessionActions.logout())
      else setRestoreError('connection')
    }).finally(() => { if (active) setRestoring(false) })
    return () => { active = false }
  }, [dispatch])
  return { restoring, restoreError }
}

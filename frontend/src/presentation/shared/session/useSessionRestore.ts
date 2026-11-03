import { useEffect, useState } from 'react'
import { appContainer } from '../../../app/appContainer'
import { useAppDispatch } from '../../../app/store'
import { LockUnavailable } from '../../../domain/repositories/AuthRepository'
import { sessionActions } from './sessionSlice'

export function useSessionRestore() {
  const dispatch = useAppDispatch()
  const [restoring, setRestoring] = useState(true)
  const [restoreError, setRestoreError] = useState(false)
  useEffect(() => {
    let active = true
    appContainer.resolve('authUseCase').refresh().then((user) => {
      if (active) dispatch(sessionActions.login(user))
    }).catch((error: unknown) => { if (active) { if (error instanceof LockUnavailable) setRestoreError(true); else dispatch(sessionActions.logout()) } }).finally(() => { if (active) setRestoring(false) })
    return () => { active = false }
  }, [dispatch])
  return { restoring, restoreError }
}

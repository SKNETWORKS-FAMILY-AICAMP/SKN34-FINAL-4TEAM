import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch } from '../../../../app/store'
import type { AuthSession } from '../../../../domain/repositories/AuthRepository'
import { SessionExpired } from '../../../../domain/repositories/ProfileRepository'
import { sessionActions } from '../../../shared/session/sessionSlice'

export function useDevicesViewModel() {
  const auth = appContainer.resolve('authUseCase')
  const dispatch = useAppDispatch()
  const controller = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const [devices, setDevices] = useState<AuthSession[] | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('기기를 불러오고 있어요.')
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    setDevices(null)
    setLoadError(false)
    setMessage('기기를 불러오고 있어요.')
    auth.sessions(request.signal).then((result) => { if (!request.signal.aborted) { setDevices(result); setMessage('') } }).catch((error: unknown) => {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) dispatch(sessionActions.logout())
      else { setLoadError(true); setMessage('기기 목록을 불러오지 못했어요. 다시 시도해 주세요.') }
    })
    return () => { request.abort(); controller.current = null }
  }, [auth, dispatch, attempt])
  async function revoke(device?: AuthSession) {
    if (busy.current || !controller.current) return
    const signal = controller.current.signal
    busy.current = true; setPending(true); setMessage('')
    try {
      if (device) await auth.revokeSession(device.id, device.current, signal)
      else await auth.logoutAll(signal)
      if (signal.aborted) return
      if (!device || device.current) dispatch(sessionActions.logout())
      else { setDevices((items) => items?.filter((item) => item.id !== device.id) ?? null); setMessage('기기에서 로그아웃했어요.') }
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof SessionExpired) dispatch(sessionActions.logout())
      else setMessage('기기에서 로그아웃하지 못했어요. 다시 시도해 주세요.')
    } finally { busy.current = false; if (!signal.aborted) setPending(false) }
  }
  return { devices, pending, message, loadError, retry: () => setAttempt((value) => value + 1), revoke }
}

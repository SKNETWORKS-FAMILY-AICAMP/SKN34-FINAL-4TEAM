import { authVersion, protectedRequest, sessions } from './auth'
import { csrf } from './csrf'
import { noticeSchema } from './HttpNotificationRepository'

const devices = '/api/v1/me/push-devices'

export async function syncMobileDevice({ installationId, token }: { installationId: string; token: string | null }, signal: AbortSignal) {
  const version = authVersion()
  const csrfToken = await csrf(signal)
  if (token === null) {
    await protectedRequest(`${devices}/${encodeURIComponent(installationId)}`,
      { signal, method: 'DELETE', headers: { 'X-CSRF-TOKEN': csrfToken } }, version)
    return
  }
  const current = (await sessions(signal)).find(session => session.current)
  if (!current) throw new Error('현재 웹 로그인 세션을 확인할 수 없어요.')
  await protectedRequest(devices, {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
    body: JSON.stringify({ installationId, sessionId: current.id, platform: 'android', token }),
  }, version)
}

export async function getMobileNotice(id: string, signal: AbortSignal) {
  const response = await protectedRequest(`/api/v1/me/notifications/${encodeURIComponent(id)}`, { signal })
  return noticeSchema.parse(await response.json())
}

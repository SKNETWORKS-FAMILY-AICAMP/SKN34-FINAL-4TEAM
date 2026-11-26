import { beforeEach, expect, it, vi } from 'vitest'

import { authVersion, protectedRequest, sessions } from './auth'
import { csrf } from './csrf'
import { syncMobileDevice } from './mobilePush'

vi.mock('./auth', () => ({ authVersion: vi.fn(), protectedRequest: vi.fn(), sessions: vi.fn() }))
vi.mock('./csrf', () => ({ csrf: vi.fn() }))

const installationId = '7da43875-6da5-4f2a-9f11-a7bb40adcd07'
const signal = new AbortController().signal

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authVersion).mockReturnValue(3)
  vi.mocked(csrf).mockResolvedValue('csrf')
  vi.mocked(protectedRequest).mockResolvedValue(new Response(null, { status: 204 }))
})

it('토큰은 현재 웹 세션으로 등록한다', async () => {
  vi.mocked(sessions).mockResolvedValue([
    { id: 'another', deviceLabel: '', createdAt: '', current: false },
    { id: 'current', deviceLabel: '', createdAt: '', current: true },
  ])
  await syncMobileDevice({ installationId, token: 'rotated-token' }, signal)
  const [url, init, version] = vi.mocked(protectedRequest).mock.calls[0]
  expect(url).toBe('/api/v1/me/push-devices')
  expect(version).toBe(3)
  expect(init?.method).toBe('POST')
  expect(JSON.parse(String(init?.body))).toEqual({ installationId, sessionId: 'current', platform: 'android', token: 'rotated-token' })
})

it('현재 세션이 없으면 등록하지 않고, 권한이 꺼지면 이 설치만 해제한다', async () => {
  vi.mocked(sessions).mockResolvedValue([])
  await expect(syncMobileDevice({ installationId, token: 'token' }, signal)).rejects.toThrow()
  expect(protectedRequest).not.toHaveBeenCalled()
  await syncMobileDevice({ installationId, token: null }, signal)
  expect(protectedRequest).toHaveBeenCalledWith('/api/v1/me/push-devices/' + installationId,
    expect.objectContaining({ method: 'DELETE' }), 3)
})

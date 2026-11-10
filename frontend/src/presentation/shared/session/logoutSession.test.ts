import { expect, it, vi } from 'vitest'
import { SessionExpired } from '../../../domain/repositories/ProfileRepository'
import { createWorldStudioLeaveGuard } from '../../features/worldstudio/viewmodel/worldStudioLeaveGuard'
import { logoutSession } from './logoutSession'

function setup(dirty = true, approved = false) {
  const confirm = vi.fn(() => approved)
  const guard = createWorldStudioLeaveGuard(confirm)
  guard.setDirty(dirty)
  const logout = vi.fn(async () => {})
  const clearSession = vi.fn()
  const navigate = vi.fn()
  const notify = vi.fn()
  return { confirm, guard, logout, clearSession, navigate, notify }
}

it('cancels before the API call and preserves the session and navigation protection', async () => {
  const deps = setup()
  expect(await logoutSession(deps)).toBe(false)
  expect(deps.confirm).toHaveBeenCalledOnce()
  expect(deps.logout).not.toHaveBeenCalled()
  expect(deps.clearSession).not.toHaveBeenCalled()
  expect(deps.navigate).not.toHaveBeenCalled()
  expect(deps.notify).not.toHaveBeenCalled()
  expect(deps.guard.shouldBlock()).toBe(true)
})

it('confirms before logout, then clears the session and allows exactly one navigation', async () => {
  const deps = setup(true, true)
  deps.logout.mockImplementation(async () => {
    expect(deps.confirm).toHaveBeenCalledOnce()
    expect(deps.clearSession).not.toHaveBeenCalled()
    expect(deps.guard.shouldBlock()).toBe(true)
  })
  deps.navigate.mockImplementation(() => {
    expect(deps.clearSession).toHaveBeenCalledOnce()
    expect(deps.guard.shouldBlock()).toBe(false)
  })
  expect(await logoutSession(deps)).toBe(true)
  expect(deps.logout).toHaveBeenCalledOnce()
  expect(deps.navigate).toHaveBeenCalledWith('/')
  expect(deps.confirm).toHaveBeenCalledOnce()
  expect(deps.guard.shouldBlock()).toBe(true)
})

it('logs out a saved world without prompting', async () => {
  const deps = setup(false)
  expect(await logoutSession(deps)).toBe(true)
  expect(deps.confirm).not.toHaveBeenCalled()
  expect(deps.clearSession).toHaveBeenCalledOnce()
})

it('keeps the session and later navigation blocked when the API fails', async () => {
  const deps = setup(true, true)
  deps.logout.mockRejectedValue(new Error('offline'))
  expect(await logoutSession(deps)).toBe(false)
  expect(deps.clearSession).not.toHaveBeenCalled()
  expect(deps.navigate).not.toHaveBeenCalled()
  expect(deps.guard.shouldBlock()).toBe(true)
  expect(deps.notify).toHaveBeenCalledWith('로그아웃하지 못했어요. 다시 시도해 주세요.')
})

it('clears an expired session and reaches login without a second cancellable prompt', async () => {
  const deps = setup(true, true)
  deps.logout.mockRejectedValue(new SessionExpired())
  expect(await logoutSession(deps)).toBe(true)
  expect(deps.clearSession).toHaveBeenCalledOnce()
  expect(deps.navigate).toHaveBeenCalledWith('/login')
  expect(deps.guard.shouldBlock()).toBe(false)
  expect(deps.confirm).toHaveBeenCalledOnce()
})

it('preserves logout outside WorldStudio without a guard', async () => {
  const deps = setup()
  expect(await logoutSession({ ...deps, guard: null })).toBe(true)
  expect(deps.logout).toHaveBeenCalledOnce()
  expect(deps.navigate).toHaveBeenCalledWith('/')
})

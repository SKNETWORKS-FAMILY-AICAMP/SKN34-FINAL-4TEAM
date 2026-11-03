import { z } from 'zod'

export class LockUnavailable extends Error {}

export async function withLock<T>(name: string, action: () => Promise<T>, immediate = false): Promise<T> {
  if (!navigator.locks) throw new LockUnavailable('Browser lock unavailable')
  let entered = false
  try {
    return await navigator.locks.request(name, { ifAvailable: immediate }, (lock) => {
      if (!lock) throw new LockUnavailable('Browser lock busy')
      entered = true
      return action()
    })
  } catch (error) {
    if (error instanceof LockUnavailable) throw error
    if (!entered) throw new LockUnavailable('Browser lock failed', { cause: error })
    throw error
  }
}

export function csrf(signal?: AbortSignal) {
  return withLock('storyfork-csrf', async () => {
    if (signal?.aborted) throw new Error('Request cancelled')
    const response = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', signal })
    if (!response.ok) throw new Error('CSRF request failed')
    return z.object({ csrfToken: z.string().min(1) }).parse(await response.json()).csrfToken
  })
}

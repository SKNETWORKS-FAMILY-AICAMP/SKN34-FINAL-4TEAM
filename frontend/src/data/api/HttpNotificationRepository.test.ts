import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../testLocks'
import { login } from './auth'
import { HttpNotificationRepository } from './HttpNotificationRepository'

const item = { id: '3f0c1b52-8f7e-4a53-9a45-0d3a9c7a1e11', kind: 'creation', summary: '작가가 새 회차를 공개했어요', targetType: 'work', targetId: 'starlight', createdAt: '2026-11-05T03:00:00Z', read: false }
type Call = [string, { method?: string; body?: string; headers: Record<string, string> }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]
const prefsBody = { items: [{ kind: 'reading', enabled: false, mutable: true }, { kind: 'creation', enabled: true, mutable: true }, { kind: 'result', enabled: true, mutable: false }] }

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'n-csrf' }) : Response.json({ accessToken: 'n-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: false } })))
  await login('u1@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('HttpNotificationRepository', () => {
  it('목록은 Bearer로 조회하고 cursor를 그대로 전달한다', async () => {
    const fetcher = vi.fn(async () => Response.json({ items: [item], nextCursor: 'c2' }))
    const page = await new HttpNotificationRepository(fetcher).list('c1')
    expect(page).toEqual({ items: [item], nextCursor: 'c2' })
    const [url, init] = callsOf(fetcher)[0]
    expect(url).toBe('/api/v1/me/notifications?limit=20&cursor=c1')
    expect(init.headers.Authorization).toBe('Bearer n-bearer')
  })

  it('알 수 없는 분류나 형식이 다른 응답은 거부한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [{ ...item, kind: 'unknown' }], nextCursor: null }))
    await expect(new HttpNotificationRepository(fetcher).list()).rejects.toThrow()
  })

  it('읽음·삭제는 CSRF를 보내고, 이미 없는 알림(404)은 성공으로 본다', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }))
    const repo = new HttpNotificationRepository(fetcher)
    await repo.markRead(item.id)
    await repo.remove(item.id)
    const [[readUrl, readInit], [delUrl, delInit]] = callsOf(fetcher)
    expect(readUrl).toBe(`/api/v1/me/notifications/${item.id}/read`)
    expect(readInit).toMatchObject({ method: 'PATCH' })
    expect(readInit.headers['X-CSRF-TOKEN']).toBe('n-csrf')
    expect(delUrl).toBe(`/api/v1/me/notifications/${item.id}`)
    expect(delInit).toMatchObject({ method: 'DELETE' })
  })

  it('읽음·삭제의 서버 오류(500)는 실패로 알린다', async () => {
    const repo = new HttpNotificationRepository(vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    await expect(repo.markRead(item.id)).rejects.toThrow()
    await expect(repo.remove(item.id)).rejects.toThrow()
  })

  it('모두 읽음은 upTo를 JSON으로 보낸다', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    await new HttpNotificationRepository(fetcher).markAllRead('2026-11-05T03:00:00Z')
    expect(callsOf(fetcher)[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ upTo: '2026-11-05T03:00:00Z' }) })
  })

  it('수신 설정은 읽기·창작 분류로 저장하고 응답으로 다시 맞춘다', async () => {
    const fetcher = vi.fn(async () => Response.json(prefsBody))
    const repo = new HttpNotificationRepository(fetcher)
    expect(await repo.getPrefs()).toEqual({ read: false, creator: true })
    expect(await repo.savePrefs({ read: false, creator: true })).toEqual({ read: false, creator: true })
    expect(callsOf(fetcher)[1][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ items: [{ kind: 'reading', enabled: false }, { kind: 'creation', enabled: true }] }) })
  })

  it('미읽음 수를 읽는다', async () => {
    expect(await new HttpNotificationRepository(vi.fn().mockResolvedValue(Response.json({ count: 3 }))).unreadCount()).toBe(3)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

import '../../testLocks'
import { login } from './auth'
import type { StreamState } from '../../domain/entities/notificationStream'
import { openNotificationStream } from './notificationStream'

const encoder = new TextEncoder()

/** 서버가 나중에 조각조각 보내는 SSE 응답을 흉내 냅니다. 요청 signal이 abort되면 실제 fetch처럼 본문을 닫습니다. */
function fakeServer() {
  const connections: { push: (text: string) => void; end: () => void }[] = []
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
    init?.signal?.addEventListener('abort', () => { try { controller.error(new DOMException('aborted', 'AbortError')) } catch { /* 이미 닫힘 */ } })
    connections.push({ push: (text) => controller.enqueue(encoder.encode(text)), end: () => controller.close() })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  return { fetcher: fetcher as unknown as typeof fetch, calls: fetcher, connections }
}

function recorder() {
  const states: StreamState[] = []
  const onSignal = vi.fn()
  return { states, onSignal, onState: (s: StreamState) => states.push(s) }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('openNotificationStream', () => {
  it('로그인하지 않았으면 연결하지 않고 off로 끝낸다', async () => {
    const server = fakeServer()
    const r = recorder()
    openNotificationStream({ ...r, fetcher: server.fetcher })
    await vi.waitFor(() => expect(r.states.at(-1)).toBe('off'))
    expect(server.calls).not.toHaveBeenCalled()
  })

  describe('로그인한 뒤', () => {
    afterEach(() => vi.unstubAllGlobals())
    const signIn = async () => {
      vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 's-csrf' }) : Response.json({ accessToken: 's-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: false } })))
      await login('u1@example.invalid', 'test-password')
    }

    it('Bearer로 연결하고 ready·changed마다 신호를 보내며 ping은 무시한다', async () => {
      await signIn()
      const server = fakeServer()
      const r = recorder()
      const close = openNotificationStream({ ...r, fetcher: server.fetcher })
      await vi.waitFor(() => expect(server.connections).toHaveLength(1))
      const [url, init] = server.calls.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
      expect(url).toBe('/api/v1/me/notifications/stream')
      expect(init.headers.Authorization).toBe('Bearer s-bearer')
      expect(init.headers.Accept).toBe('text/event-stream')
      server.connections[0].push('event:ready\ndata:ok\n\n')
      await vi.waitFor(() => expect(r.states.at(-1)).toBe('live'))
      expect(r.onSignal).toHaveBeenCalledTimes(1)
      server.connections[0].push(':ping\n\n')
      server.connections[0].push('event:chan')
      server.connections[0].push('ged\ndata:1\n\n')
      await vi.waitFor(() => expect(r.onSignal).toHaveBeenCalledTimes(2))
      await flush()
      expect(r.onSignal).toHaveBeenCalledTimes(2)
      close()
    })

    it('끊기면 offline을 알리고 다시 연결해 ready로 재조회 신호를 보낸다', async () => {
      await signIn()
      const server = fakeServer()
      const r = recorder()
      const close = openNotificationStream({ ...r, fetcher: server.fetcher, backoff: () => 0 })
      await vi.waitFor(() => expect(server.connections).toHaveLength(1))
      server.connections[0].push('event:ready\ndata:ok\n\n')
      await vi.waitFor(() => expect(r.onSignal).toHaveBeenCalledTimes(1))
      // 네트워크 오류로 연결이 끊김
      ;(server.fetcher as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'))
      server.connections[0].end()
      await vi.waitFor(() => expect(r.states).toContain('offline'))
      await vi.waitFor(() => expect(server.connections).toHaveLength(2))
      server.connections[1].push('event:ready\ndata:ok\n\n')
      await vi.waitFor(() => expect(r.onSignal).toHaveBeenCalledTimes(2))
      expect(r.states.at(-1)).toBe('live')
      close()
    })

    it('서버 오류 응답은 offline으로 보고 계속 다시 시도한다', async () => {
      await signIn()
      const fetcher = vi.fn(async () => new Response(null, { status: 502 }))
      const r = recorder()
      const close = openNotificationStream({ ...r, fetcher: fetcher as unknown as typeof fetch, backoff: () => 5 })
      await vi.waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2))
      expect(r.states).toContain('offline')
      close()
    })

    it('닫으면 열린 연결을 끊고 더 이상 다시 연결하지 않는다', async () => {
      await signIn()
      const server = fakeServer()
      const r = recorder()
      const close = openNotificationStream({ ...r, fetcher: server.fetcher, backoff: () => 0 })
      await vi.waitFor(() => expect(server.connections).toHaveLength(1))
      server.connections[0].push('event:ready\ndata:ok\n\n')
      await vi.waitFor(() => expect(r.states.at(-1)).toBe('live'))
      close()
      await flush(); await flush()
      expect(server.calls).toHaveBeenCalledTimes(1)
      expect(r.onSignal).toHaveBeenCalledTimes(1)
    })

    it('오래 아무것도 오지 않으면 연결을 끊고 다시 연결한다', async () => {
      await signIn()
      const server = fakeServer()
      const r = recorder()
      const close = openNotificationStream({ ...r, fetcher: server.fetcher, idleMs: 30, backoff: () => 0 })
      await vi.waitFor(() => expect(server.connections.length).toBeGreaterThanOrEqual(2))
      close()
    })
  })
})

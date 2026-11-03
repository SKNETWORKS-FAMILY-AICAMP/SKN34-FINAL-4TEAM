// @vitest-environment jsdom
import './testLocks'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderApp } from './test/renderApp'
import { refresh } from './data/api/auth'
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 })))
  await refresh().catch(() => {})
})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('uses server authorization on persisted studio routes without a demo session',async()=>{
  vi.stubGlobal('fetch',vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : Response.json({detail:'서버 인증이 필요합니다.'},{status:401})))
  renderApp('/studio/00000000-0000-0000-0000-000000000001')
  expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('서버 인증이 필요합니다.'))
  expect(screen.queryByRole('button',{name:'데모 계정으로 바로 시작'})).toBeNull()
})

it.each(['/content', '/studio/00000000-0000-0000-0000-000000000001'])('waits for restored memory authentication before loading %s', async path => {
  let finish!: (response: Response) => void
  const pending = new Promise<Response>(resolve => { finish = resolve })
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (url.endsWith('/refresh')) return pending
    return Response.json([])
  })
  vi.stubGlobal('fetch', fetcher)
  renderApp(path)
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/refresh'))).toBe(true))
  expect(fetcher.mock.calls.some(([url]) => url.startsWith('/api/v1/works'))).toBe(false)
  await act(async () => { finish(Response.json({ accessToken: 'restored-content', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })) })
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.startsWith('/api/v1/works'))).toBe(true))
  const content = fetcher.mock.calls.find(([url]) => url.startsWith('/api/v1/works'))
  expect(content?.[1]).toMatchObject({ credentials: 'same-origin', headers: { Authorization: 'Bearer restored-content' } })
})

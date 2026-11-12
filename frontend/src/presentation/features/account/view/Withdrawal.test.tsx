// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import '../../../../test/testLocks'

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { renderApp } from '../../../../test/renderApp'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const me = { id: '1', nickname: '읽는사람', email: 'reader@storyfork.demo', operator: false }
const pending = { status: 'PENDING', requestedAt: '2026-11-12T01:00:00Z', dueAt: '2026-12-12T01:00:00Z' }
type Call = { url: string; method: string; body: unknown; signal?: AbortSignal | null }

/** 로그인한 사용자로 프로필을 연다. `withdrawal`이 탈퇴 API 응답을 정한다. */
function setup(withdrawal: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (url.endsWith('/refresh')) return Response.json({ accessToken: 'token', user: me })
    if (url.endsWith('/api/v1/me/withdrawal')) {
      const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, signal: init?.signal }
      calls.push(call)
      return withdrawal(call)
    }
    if (url.includes('/auth/sessions')) return Response.json({ sessions: [] })
    return Response.json(me)
  }))
  const store = createAppStore({ role: 'user' })
  return { calls, ...renderApp('/me/profile', store) }
}
const toastIs = (t: string | RegExp) => waitFor(() => expect(document.getElementById('toast')!.textContent).toMatch(t))
/** 프로필 화면은 지연 로딩이라 파일의 첫 테스트에서 오래 걸릴 수 있어, 화면이 처음 뜨기를 기다릴 때만 넉넉히 기다린다. */
const card = (name: string) => screen.findByRole('button', { name }, { timeout: 5000 })

describe('회원탈퇴 (U30, UC-22 A3)', () => {
  it('비밀번호와 사유로 탈퇴를 요청하면 로그아웃하고 30일 유예를 안내한다', async () => {
    const { calls, store } = setup((call) => call.method === 'POST' ? Response.json(pending, { status: 202 }) : Response.json({ status: 'NONE' }))
    fireEvent.click(await card('회원탈퇴'))
    const sheet = await screen.findByRole('dialog', { name: '회원탈퇴' })
    within(sheet).getByText(/30일 유예 기간/)
    expect((within(sheet).getByRole('button', { name: '탈퇴하기' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(sheet).getByLabelText('비밀번호'), { target: { value: 'test-password' } })
    fireEvent.change(within(sheet).getByLabelText('탈퇴 사유 (선택)'), { target: { value: '  더 이상 쓰지 않아요  ' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '탈퇴하기' }))
    await toastIs('탈퇴를 요청했어요')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ password: 'test-password', reason: '더 이상 쓰지 않아요' })
    expect(store.getState().session.role).toBeNull()
  })

  it('비밀번호가 틀리면 시트를 열어 둔 채 안내하고 로그인 상태를 유지한다', async () => {
    const { store } = setup((call) => call.method === 'POST' ? new Response(null, { status: 403 }) : Response.json({ status: 'NONE' }))
    fireEvent.click(await card('회원탈퇴'))
    const sheet = await screen.findByRole('dialog', { name: '회원탈퇴' })
    fireEvent.change(within(sheet).getByLabelText('비밀번호'), { target: { value: 'wrong' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '탈퇴하기' }))
    expect((await within(sheet).findByRole('alert')).textContent).toBe('비밀번호가 맞지 않아요.')
    expect(store.getState().session.role).toBe('user')
  })

  it('다른 곳에서 이미 요청했으면(409) 안내하고 유예 중 상태로 다시 읽는다', async () => {
    let requested = false
    setup((call) => {
      if (call.method === 'POST') { requested = true; return new Response(null, { status: 409 }) }
      return Response.json(requested ? pending : { status: 'NONE' })
    })
    fireEvent.click(await card('회원탈퇴'))
    const sheet = await screen.findByRole('dialog', { name: '회원탈퇴' })
    fireEvent.change(within(sheet).getByLabelText('비밀번호'), { target: { value: 'pw' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '탈퇴하기' }))
    expect(await card('탈퇴 요청 취소')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('이미 진행 중인 탈퇴 요청이 있어요.')
  })

  it('사유가 비어 있으면 사유 없이 보낸다', async () => {
    const { calls } = setup((call) => call.method === 'POST' ? Response.json(pending, { status: 202 }) : Response.json({ status: 'NONE' }))
    fireEvent.click(await card('회원탈퇴'))
    const sheet = await screen.findByRole('dialog', { name: '회원탈퇴' })
    fireEvent.change(within(sheet).getByLabelText('비밀번호'), { target: { value: 'pw' } })
    fireEvent.change(within(sheet).getByLabelText('탈퇴 사유 (선택)'), { target: { value: '   ' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '탈퇴하기' }))
    await toastIs('탈퇴를 요청했어요')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ password: 'pw' })
  })

  it('유예 중이면 기한을 보이고 탈퇴 요청을 취소할 수 있다', async () => {
    const { calls } = setup((call) => call.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(pending))
    fireEvent.click(await card('탈퇴 요청 취소'))
    await toastIs('탈퇴 요청을 취소했어요')
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
    expect(await card('회원탈퇴')).toBeTruthy()
  })

  it('유예 기한이 지나 복구할 수 없으면 안내한다', async () => {
    setup((call) => call.method === 'DELETE' ? new Response(null, { status: 409 }) : Response.json(pending))
    fireEvent.click(await card('탈퇴 요청 취소'))
    expect((await screen.findByRole('alert')).textContent).toBe('유예 기간이 지나 복구할 수 없어요.')
    expect((screen.getByRole('button', { name: '탈퇴 요청 취소' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('유예 기한이 이미 지났으면 탈퇴 요청 취소를 막는다', async () => {
    const { calls } = setup(() => Response.json({ ...pending, dueAt: '2001-01-01T00:00:00Z' }))
    expect((await card('탈퇴 요청 취소') as HTMLButtonElement).disabled).toBe(true)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('화면을 떠나면 진행 중인 탈퇴 요청을 취소하고 로그아웃하지 않는다', async () => {
    let post: Call | undefined
    const { store } = setup((call) => {
      if (call.method !== 'POST') return Response.json({ status: 'NONE' })
      post = call
      return new Promise<Response>((_, reject) => call.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    fireEvent.click(await card('회원탈퇴'))
    const sheet = await screen.findByRole('dialog', { name: '회원탈퇴' })
    fireEvent.change(within(sheet).getByLabelText('비밀번호'), { target: { value: 'pw' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '탈퇴하기' }))
    await waitFor(() => expect(post).toBeTruthy())
    cleanup()
    expect(post?.signal?.aborted).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.getState().session.role).toBe('user')
  })

  it('상태를 읽지 못하면 실패를 알리고 다시 시도할 수 있다', async () => {
    let fail = true
    setup(() => fail ? new Response(null, { status: 500 }) : Response.json({ status: 'NONE' }))
    expect((await screen.findByText('탈퇴 상태를 불러오지 못했어요. 다시 시도해 주세요.', {}, { timeout: 5000 })).getAttribute('role')).toBe('alert')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '탈퇴 상태 다시 시도' }))
    expect(await card('회원탈퇴')).toBeTruthy()
  })
})

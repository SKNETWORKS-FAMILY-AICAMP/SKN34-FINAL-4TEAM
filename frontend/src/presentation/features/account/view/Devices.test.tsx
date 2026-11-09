// @vitest-environment jsdom
import '../../../../test/testLocks'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { refresh } from '../../../../data/api/auth'
import { Devices } from './Devices'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const user = { id: '1', nickname: '독자', email: 'reader@example.com', operator: false }
const firefox = { id: 'f', deviceLabel: 'Firefox/140.0 (X11; Linux x86_64)', current: false, createdAt: '2026-01-01T00:00:00Z' }
const chrome = { id: 'c', deviceLabel: 'Chrome/140.0 (Windows NT 10.0) Safari/537.36', current: false, createdAt: '2026-01-01T00:00:00Z' }
const safari = { id: 's', deviceLabel: 'Safari/605.1.15 (Macintosh; Intel Mac OS X 14_0)', current: false, createdAt: '2026-01-01T00:00:00Z' }
const logout = (name: string) => screen.findByRole<HTMLButtonElement>('button', { name: `${name} 로그아웃` })

/**
 * `settled`가 처음 통과하는 DOM 상태에서의 초점. waitFor는 DOM 변경 직후(커밋 뒤 microtask)에 처음 확인하므로,
 * 행이 사라진 그 상태에서 초점이 이미 옮겨져 있어야 통과한다. passive effect로 옮기면 다음 task까지 초점이 body에 놓인다.
 */
const focusWhenSettled = (settled: () => void) => waitFor(() => { settled(); return document.activeElement })

/** 서버가 가진 기기 목록을 흉내 낸다. 삭제 요청은 `revoke`가 정하며 성공하면 목록에서 빠진다. */
async function setup(devices: object[], revoke: () => Promise<Response> = async () => new Response(null, { status: 204 })) {
  let list = devices
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/refresh')) return Response.json({ accessToken: 'token', user })
    if (path.endsWith('/sessions') && !init?.method) return Response.json({ sessions: list })
    if (path.includes('/sessions/')) {
      const response = await revoke()
      if (response.ok) list = list.filter((device) => !path.endsWith(`/${(device as { id: string }).id}`))
      return response
    }
    return Response.json(user)
  }))
  await refresh() // 보호 API 요청에 쓸 액세스 토큰을 앱의 세션 복원처럼 먼저 받아 둔다.
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><Devices /></MemoryRouter></Provider>)
}

describe('모든 기기 로그아웃 확인', () => {
  it('확인이 열리면 취소로 초점이 가고, 닫으면 열었던 버튼으로 돌아온다', async () => {
    await setup([firefox])
    const opener = await screen.findByRole('button', { name: '모든 기기 로그아웃' })
    opener.focus()
    fireEvent.click(opener)
    const confirmation = within(screen.getByRole('group', { name: '모든 기기 로그아웃 확인' }))
    await waitFor(() => expect(document.activeElement).toBe(confirmation.getByRole('button', { name: '취소' })))
    fireEvent.click(confirmation.getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('group', { name: '모든 기기 로그아웃 확인' })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('기기 로그아웃 뒤 초점', () => {
  it.each([
    ['가운데 기기', 'Chrome · Windows', 'Safari · macOS'],
    ['마지막 기기', 'Safari · macOS', 'Chrome · Windows'],
  ])('%s를 로그아웃하면 다음(없으면 이전) 기기의 로그아웃 버튼으로 초점이 간다', async (_name, removed, expected) => {
    await setup([firefox, chrome, safari])
    const button = await logout(removed)
    button.focus()
    fireEvent.click(button)
    const focused = await focusWhenSettled(() => expect(screen.queryByRole('button', { name: `${removed} 로그아웃` })).toBeNull())
    expect(focused).toBe(screen.getByRole('button', { name: `${expected} 로그아웃` }))
  })

  it('남은 기기가 없으면 로그인 기기 제목으로 초점이 간다', async () => {
    await setup([firefox])
    const button = await logout('Firefox · Linux')
    button.focus()
    fireEvent.click(button)
    const focused = await focusWhenSettled(() => screen.getByText('로그인 기기가 없어요.'))
    const title = screen.getByRole('heading', { name: '로그인 기기' })
    expect(title.getAttribute('tabindex')).toBe('-1')
    expect(focused).toBe(title)
  })

  it('로그아웃에 실패하면 초점을 잃은 사용자를 잠겼다 풀린 같은 버튼으로 돌려보낸다', async () => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    await setup([firefox], () => pending)
    const button = await logout('Firefox · Linux')
    fireEvent.click(button) // 눌러도 초점이 버튼에 없거나(Safari) disabled가 되며 초점을 잃은 상태와 같다.
    await waitFor(() => expect(button.disabled).toBe(true))
    await act(async () => { finish(new Response(null, { status: 503 })) })
    await screen.findByText(/로그아웃하지 못했어요/)
    expect(document.activeElement).toBe(button)
  })
})

// @vitest-environment jsdom
import './testLocks'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderApp } from './test/renderApp'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

it('removes the reset fragment and reports a rejected reset', async () => {
  window.history.replaceState(null, '', '/auth/reset-password#token=secret')
  const mock = vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 }))
  vi.stubGlobal('fetch', mock)
  renderApp('/auth/reset-password#token=secret')
  expect(window.location.hash).toBe('')
  fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'password123' } })
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'password123' } })
  fireEvent.click(screen.getByRole('button', { name: '비밀번호 변경' }))
  expect(await screen.findByText(/비밀번호를 변경하지 못했어요/)).toBeTruthy()
  expect(mock).toHaveBeenCalledWith('/api/v1/auth/reset-password', expect.objectContaining({ body: JSON.stringify({ token: 'secret', newPassword: 'password123' }) }))
})

function fillReset(password: string, confirmation = password) {
  fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: confirmation } })
  fireEvent.submit(screen.getByRole('button', { name: '비밀번호 변경' }).closest('form')!)
}

it('재설정 확인 불일치 때 입력을 유지하고 해당 필드를 안내한다', async () => {
  window.history.replaceState(null, '', '/auth/reset-password#token=secret')
  const mock = vi.fn(async (_path: string) => new Response(null, { status: 401 }))
  vi.stubGlobal('fetch', mock)
  renderApp('/auth/reset-password#token=secret')
  fillReset('password123', 'password456')
  expect(screen.getByLabelText<HTMLInputElement>('새 비밀번호').value).toBe('password123')
  const confirmation = screen.getByLabelText<HTMLInputElement>('새 비밀번호 확인')
  expect(confirmation.value).toBe('password456')
  expect(confirmation.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(confirmation.getAttribute('aria-describedby')!)?.textContent).toContain('비밀번호가 서로 달라요')
  expect(document.activeElement).toBe(confirmation)
  expect(mock.mock.calls.some(([path]) => String(path).endsWith('/reset-password'))).toBe(false)
})

it('재설정 비밀번호는 짧은 기본 안내와 접힌 길이 상세를 제공한다', () => {
  window.history.replaceState(null, '', '/auth/reset-password#token=secret')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
  renderApp('/auth/reset-password#token=secret')
  expect(document.getElementById('reset-password-help')?.textContent).toBe('8자 이상 입력해 주세요. 공백만으로는 만들 수 없어요.')
  const summary = screen.getByText('비밀번호 길이 안내')
  const details = summary.closest('details')!
  expect(details.open).toBe(false)
  expect(details.textContent).toContain('최대 72바이트(UTF-8)까지 입력할 수 있어요. 한글·이모지는 영문보다 더 많은 공간을 사용해요.')
  fireEvent.click(summary)
  expect(details.open).toBe(true)
  fireEvent.click(summary)
  expect(details.open).toBe(false)
})

it.each([
  ['        ', '공백만으로는 비밀번호를 만들 수 없어요.'],
  ['1234567', '비밀번호는 8자 이상이에요'],
  ['a'.repeat(73), '비밀번호가 너무 길어요. 글자 수를 줄여 주세요. 한글·이모지는 영문보다 더 많은 공간을 사용해요.'],
  ['한'.repeat(25), '비밀번호가 너무 길어요. 글자 수를 줄여 주세요. 한글·이모지는 영문보다 더 많은 공간을 사용해요.'],
  ['🙂'.repeat(18) + 'a', '비밀번호가 너무 길어요. 글자 수를 줄여 주세요. 한글·이모지는 영문보다 더 많은 공간을 사용해요.'],
])('재설정 비밀번호 정책을 서버 요청 전에 확인한다 (%s)', (password, message) => {
  window.history.replaceState(null, '', '/auth/reset-password#token=secret')
  const mock = vi.fn(async (_path: string) => new Response(null, { status: 401 }))
  vi.stubGlobal('fetch', mock)
  renderApp('/auth/reset-password#token=secret')
  fillReset(password)
  expect(screen.getByRole('alert').textContent).toBe(message)
  const input = screen.getByLabelText<HTMLInputElement>('새 비밀번호')
  expect(input.value).toBe(password)
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')).toBe('reset-password-help reset-password-error')
  expect(document.activeElement).toBe(input)
  expect(mock.mock.calls.some(([path]) => path.endsWith('/reset-password'))).toBe(false)
})

it.each(['a'.repeat(72), '한'.repeat(24), '🙂'.repeat(18)])('재설정은 72바이트 경계 비밀번호를 그대로 전송한다 (%s)', async (password) => {
  window.history.replaceState(null, '', '/auth/reset-password#token=secret')
  const mock = vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: path.endsWith('/reset-password') ? 204 : 401 }))
  vi.stubGlobal('fetch', mock)
  renderApp('/auth/reset-password#token=secret')
  fillReset(password)
  expect(await screen.findByText('비밀번호를 변경했어요. 로그인해 주세요.')).toBeTruthy()
  expect(mock).toHaveBeenCalledWith('/api/v1/auth/reset-password', expect.objectContaining({ body: JSON.stringify({ token: 'secret', newPassword: password }) }))
})

it('토큰 없는 재설정 화면은 제출 폼 대신 새 링크를 안내한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
  renderApp('/auth/reset-password')
  expect(screen.getByRole('alert').textContent).toContain('링크가 올바르지 않아요')
  expect(screen.queryByRole('button', { name: '비밀번호 변경' })).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: '새 링크 요청' }))
  expect(await screen.findByRole('heading', { name: '비밀번호 찾기' })).toBeTruthy()
})

it('재설정 성공 후 폼을 닫고 완료 토큰을 다시 보내지 않는다', async () => {
  window.history.replaceState(null, '', '/auth/reset-password#token=secret')
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  const mock = vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : path.endsWith('/reset-password') ? pending : new Response(null, { status: 401 }))
  vi.stubGlobal('fetch', mock)
  renderApp('/auth/reset-password#token=secret')
  fillReset('한'.repeat(24))
  await waitFor(() => expect(mock.mock.calls.filter(([path]) => path.endsWith('/reset-password'))).toHaveLength(1))
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '처리 중…' }).disabled).toBe(true)
  fireEvent.submit(screen.getByRole('button', { name: '처리 중…' }).closest('form')!)
  await act(async () => { finish(new Response(null, { status: 204 })) })
  expect(await screen.findByText('비밀번호를 변경했어요. 로그인해 주세요.')).toBeTruthy()
  expect(screen.queryByLabelText('새 비밀번호')).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: '로그인으로' }))
  expect(await screen.findByRole('heading', { name: '로그인' })).toBeTruthy()
  expect(mock.mock.calls.filter(([path]) => path.endsWith('/reset-password'))).toHaveLength(1)
})

it('만료된 재설정 링크는 폼 대신 새 링크 요청을 제공한다', async () => {
  window.history.replaceState(null, '', '/auth/reset-password#token=secret')
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 400 })))
  renderApp('/auth/reset-password#token=secret')
  fillReset('password123')
  expect((await screen.findByRole('alert')).textContent).toContain('링크가 만료됐거나 이미 사용됐을 수 있어요')
  expect(screen.queryByLabelText('새 비밀번호')).toBeNull()
  expect(screen.getByRole('link', { name: '새 링크 요청' })).toBeTruthy()
})

it('재설정 서버 오류는 만료로 단정하지 않고 입력과 재시도를 보존한다', async () => {
  window.history.replaceState(null, '', '/auth/reset-password#token=secret')
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 503 })))
  renderApp('/auth/reset-password#token=secret')
  fillReset('password123')
  expect((await screen.findByRole('alert')).textContent).toContain('다시 시도해 주세요')
  expect(screen.queryByText(/링크가 만료됐거나/)).toBeNull()
  expect(screen.getByLabelText<HTMLInputElement>('새 비밀번호').value).toBe('password123')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '비밀번호 변경' }).disabled).toBe(false)
})

it('기기 목록 오류를 같은 화면에서 재시도하고 서버 목록을 표시한다', async () => {
  const user = { id: '1', nickname: '독자', email: 'reader@example.com', operator: false }
  let attempts = 0
  const mock = vi.fn(async (path: string) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/refresh')) return Response.json({ accessToken: 'token', user })
    if (path.endsWith('/sessions')) return ++attempts === 1 ? new Response(null, { status: 503 }) : Response.json({ sessions: [] })
    return Response.json(user)
  })
  vi.stubGlobal('fetch', mock)
  renderApp('/me/profile')
  const retry = await screen.findByRole('button', { name: '기기 목록 다시 시도' })
  expect(screen.queryByText('로그인 기기가 없어요.')).toBeNull()
  fireEvent.click(retry)
  expect(await screen.findByText('로그인 기기가 없어요.')).toBeTruthy()
  expect(attempts).toBe(2)
  expect(screen.queryByRole('button', { name: '기기 목록 다시 시도' })).toBeNull()
})

it('비밀번호 찾기는 계정 존재를 구분하지 않고 실제 요청 결과를 안내한다', async () => {
  const mock = vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: path.endsWith('/forgot-password') ? 202 : 401 }))
  vi.stubGlobal('fetch', mock)
  renderApp('/auth/forgot-password')
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'unknown@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: '재설정 메일 요청' }))
  expect(await screen.findByText(/해당 계정이 있으면 재설정 메일이 발송/)).toBeTruthy()
  expect(mock).toHaveBeenCalledWith('/api/v1/auth/forgot-password', expect.objectContaining({ body: JSON.stringify({ email: 'unknown@example.com' }) }))
})

it('복구 접수 후 주소와 미도착 안내를 남기고 수정한 주소로만 다시 요청한다', async () => {
  const mock = vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: path.endsWith('/forgot-password') ? 202 : 401 }))
  vi.stubGlobal('fetch', mock)
  renderApp('/auth/forgot-password')
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'first@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: '재설정 메일 요청' }))
  await screen.findByRole('status')
  expect(screen.getByText('first@example.com')).toBeTruthy()
  expect(screen.getByText(/스팸함/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '재설정 메일 요청' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '주소 수정·다시 요청' }))
  expect(screen.getByLabelText<HTMLInputElement>('이메일').value).toBe('first@example.com')
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'second@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: '재설정 메일 요청' }))
  await screen.findByRole('status')
  expect(screen.getByText('second@example.com')).toBeTruthy()
  expect(mock.mock.calls.filter(([path]) => path.endsWith('/forgot-password'))).toHaveLength(2)
})

it('이메일 변경 확인 실패는 프로필에서 새 확인 메일을 요청하도록 안내한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
  renderApp('/auth/verify-email-change')
  expect(screen.getByRole('status').textContent).toContain('인증 링크가 올바르지 않아요')
  expect(screen.getByRole('link', { name: '프로필에서 새 확인 메일 요청' }).getAttribute('href')).toBe('/me/profile')
  expect(screen.getByText(/기존 이메일/)).toBeTruthy()
})

it('이메일 인증 성공은 자동 로그인 없이 로그인 링크를 우선 제공한다', async () => {
  window.history.replaceState(null, '', '/auth/verify-email#token=secret')
  const mock = vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: path.endsWith('/verify-email') ? 204 : 401 }))
  vi.stubGlobal('fetch', mock)
  const { store } = renderApp('/auth/verify-email#token=secret')
  expect(mock.mock.calls.some(([path]) => path.endsWith('/verify-email'))).toBe(false)
  fireEvent.change(screen.getByLabelText('가입 비밀번호'), { target: { value: 'password123' } })
  fireEvent.click(screen.getByRole('button', { name: '이메일 확인' }))
  expect((await screen.findByText(/이메일 인증이 완료됐어요/))).toBeTruthy()
  expect(mock).toHaveBeenCalledWith('/api/v1/auth/verify-email', expect.objectContaining({ body: JSON.stringify({ token: 'secret', password: 'password123' }) }))
  expect(screen.getByRole('link', { name: '로그인' }).classList.contains('pri')).toBe(true)
  expect(screen.queryByRole('link', { name: '확인 메일 재발송' })).toBeNull()
  expect(store.getState().session.role).toBeNull()
})

it('shows only server-confirmed devices and preserves them after failed revocation', async () => {
  const user = { id: '1', nickname: '독자', email: 'reader@example.com', operator: false }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (path.endsWith('/refresh')) return Response.json({ accessToken: 'token', user })
    if (path.endsWith('/sessions') && !init?.method) return Response.json({ sessions: [{ id: '1', deviceLabel: 'Browser', createdAt: '2026-01-01T00:00:00Z', current: false }] })
    if (path.includes('/sessions/')) return new Response(null, { status: 500 })
    return Response.json(user)
  }))
  renderApp('/me/profile')
  fireEvent.click(await screen.findByRole('button', { name: '알 수 없는 브라우저 · 알 수 없는 운영체제 로그아웃' }))
  await waitFor(() => expect(screen.getByText(/기기에서 로그아웃하지 못했어요/)).toBeTruthy())
  expect(screen.getByText('Browser')).toBeTruthy()
})

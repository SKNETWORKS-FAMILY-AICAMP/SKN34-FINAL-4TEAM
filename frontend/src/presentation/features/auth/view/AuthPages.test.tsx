// @vitest-environment jsdom
import '../../../../test/testLocks'

import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { renderApp } from '../../../../test/renderApp'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

/** csrf만 성공하고 세션 복원(/refresh)은 401이다. 그 밖의 요청은 `handler`가 정하거나 `status`로 응답한다. */
const respond = (status: number, handler?: (path: string) => Promise<Response> | undefined) => vi.fn(async (path: string) => {
  if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
  if (path.endsWith('/refresh')) return new Response(null, { status: 401 })
  return handler?.(path) ?? new Response(null, { status })
})
const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label)
const enter = (label: string, value: string) => fireEvent.change(field(label), { target: { value } })
const submit = (button: string | RegExp) => fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!)
const focused = (element: HTMLElement) => waitFor(() => expect(document.activeElement).toBe(element))

function submitLogin() {
  enter('이메일', 'reader@example.com')
  enter('비밀번호', 'wrong-password')
  submit('로그인')
}
function submitSignup() {
  enter('이메일', 'reader@example.com')
  enter('닉네임', '독자')
  enter('비밀번호', 'password123')
  enter('비밀번호 확인', 'password123')
  submit('가입 요청')
}

describe('로그인 실패와 요청 중 (L01)', () => {
  it.each([
    [401, true],
    [503, false],
  ])('로그인 %s 실패는 오류 메시지로 초점을 보내고, 입력 오류 표시는 자격 증명 실패일 때만 한다', async (status, credentials) => {
    vi.stubGlobal('fetch', respond(status))
    renderApp('/login')
    submitLogin()
    const alert = await screen.findByRole('alert')
    await focused(alert)
    for (const label of ['이메일', '비밀번호']) {
      expect(field(label).getAttribute('aria-invalid')).toBe(String(credentials))
      expect(field(label).getAttribute('aria-describedby')).toBe(credentials ? alert.id : null)
    }
    if (credentials) expect(alert.id).not.toBe('')
  })

  it('요청 중에는 입력을 disabled 대신 읽기 전용으로 잠가 초점을 유지하고 중복 제출하지 않는다', async () => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    const fetch = respond(401, (path) => path.endsWith('/login') ? pending : undefined)
    vi.stubGlobal('fetch', fetch)
    renderApp('/login')
    enter('이메일', 'reader@example.com')
    enter('비밀번호', 'wrong-password')
    field('비밀번호').focus()
    const form = document.getElementById('lgf') as HTMLFormElement
    fireEvent.submit(form)
    const button = await screen.findByRole<HTMLButtonElement>('button', { name: '로그인 중…' })
    expect(button.disabled).toBe(true)
    for (const label of ['이메일', '비밀번호']) {
      expect(field(label).disabled).toBe(false)
      expect(field(label).readOnly).toBe(true)
    }
    expect(form.getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(field('비밀번호'))
    fireEvent.submit(form)
    expect(fetch.mock.calls.filter(([path]) => path.endsWith('/login'))).toHaveLength(1)
    await act(async () => { finish(new Response(null, { status: 401 })) })
    expect(field('이메일').readOnly).toBe(false)
  })

  it('로그인이 필요하다는 안내(loginMsg)를 상태 영역으로 알린다', () => {
    vi.stubGlobal('fetch', respond(401))
    renderApp('/login', createAppStore({ loginMsg: '내 서재는 로그인 후 볼 수 있어요.' }))
    expect(screen.getByText('내 서재는 로그인 후 볼 수 있어요.').getAttribute('role')).toBe('status')
  })
})

describe('복구·재발송 요청 중', () => {
  it.each([
    ['/auth/forgot-password', '/forgot-password', /처리 중/, '재설정 메일 요청'],
    ['/auth/resend-verification', '/resend-verification', /재발송 중/, '확인 메일 재발송'],
  ])('%s 요청 중에는 이메일 입력을 읽기 전용으로 잠가 초점을 유지한다', async (path, endpoint, busyName, idleName) => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    vi.stubGlobal('fetch', respond(202, (url) => url.endsWith(endpoint) ? pending : undefined))
    renderApp(path)
    enter('이메일', 'reader@example.com')
    field('이메일').focus()
    submit(idleName)
    const button = await screen.findByRole<HTMLButtonElement>('button', { name: busyName })
    expect(button.disabled).toBe(true)
    expect(field('이메일').disabled).toBe(false)
    expect(field('이메일').readOnly).toBe(true)
    expect(button.closest('form')!.getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(field('이메일'))
    await act(async () => { finish(new Response(null, { status: 202 })) })
  })
})

describe('결과 영역으로 초점 이동', () => {
  it('가입 요청 성공 뒤 폼이 사라져도 초점을 상태 메시지로 옮긴다', async () => {
    vi.stubGlobal('fetch', respond(202))
    renderApp('/me/signup')
    submitSignup()
    await focused(await screen.findByRole('status'))
  })

  it('가입 요청 실패 뒤 입력이 잠겼다 풀려도 초점을 오류 메시지로 옮긴다', async () => {
    vi.stubGlobal('fetch', respond(409))
    renderApp('/me/signup')
    submitSignup()
    await focused(await screen.findByRole('alert'))
  })

  it('확인 메일 재발송 성공 뒤 초점을 상태 메시지로 옮긴다', async () => {
    vi.stubGlobal('fetch', respond(202))
    renderApp('/auth/resend-verification')
    enter('이메일', 'reader@example.com')
    submit('확인 메일 재발송')
    await focused(await screen.findByRole('status'))
  })

  it('확인 메일 재발송 실패 뒤 초점을 오류 메시지로 옮긴다', async () => {
    vi.stubGlobal('fetch', respond(503))
    renderApp('/auth/resend-verification')
    enter('이메일', 'reader@example.com')
    submit('확인 메일 재발송')
    await focused(await screen.findByRole('alert'))
  })

  it('비밀번호 재설정 메일 요청 성공 뒤 초점을 상태 메시지로 옮긴다', async () => {
    vi.stubGlobal('fetch', respond(202))
    renderApp('/auth/forgot-password')
    enter('이메일', 'reader@example.com')
    submit('재설정 메일 요청')
    await focused(await screen.findByRole('status'))
  })

  it('비밀번호 재설정 메일 요청 실패 뒤 초점을 오류 메시지로 옮긴다', async () => {
    vi.stubGlobal('fetch', respond(503))
    renderApp('/auth/forgot-password')
    enter('이메일', 'reader@example.com')
    submit('재설정 메일 요청')
    await focused(await screen.findByRole('alert'))
  })

  it('비밀번호 변경 성공 뒤 폼이 사라져도 초점을 상태 메시지로 옮긴다', async () => {
    window.history.replaceState(null, '', '/auth/reset-password#token=secret')
    vi.stubGlobal('fetch', respond(204))
    renderApp('/auth/reset-password#token=secret')
    enter('새 비밀번호', 'password123')
    enter('새 비밀번호 확인', 'password123')
    submit('비밀번호 변경')
    await focused(await screen.findByRole('status'))
  })

  it('이메일 확인 성공 뒤 폼이 사라져도 초점을 상태 메시지로 옮긴다', async () => {
    window.history.replaceState(null, '', '/auth/verify-email#token=secret')
    vi.stubGlobal('fetch', respond(204))
    renderApp('/auth/verify-email#token=secret')
    enter('가입 비밀번호', 'password123')
    submit('이메일 확인')
    await focused(await screen.findByText(/이메일 인증이 완료됐어요/))
  })
})

describe('본문 랜드마크와 문서 제목', () => {
  it.each([
    ['/login', '로그인'],
    ['/me/signup', '회원가입'],
    ['/auth/resend-verification', '인증 메일 재발송'],
    ['/auth/forgot-password', '비밀번호 찾기'],
    ['/auth/reset-password', '비밀번호 재설정'],
    ['/auth/verify-email', '이메일 인증'],
    ['/auth/verify-email-change', '이메일 변경 확인'],
  ])('인증 경로 %s는 main#main을 가지고, 탭 제목은 "%s · STORYFORK"이며 떠나면 기본 제목으로 돌아간다', (path, name) => {
    vi.stubGlobal('fetch', respond(401))
    renderApp(path)
    const main = screen.getByRole('main')
    expect(main.id).toBe('main')
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(document.title).toBe(`${name} · STORYFORK`)
    cleanup()
    expect(document.title).toBe('STORYFORK')
  })
})

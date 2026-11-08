// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import '../../../../test/testLocks'

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { renderApp } from '../../../../test/renderApp'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const me = { id: '1', nickname: '읽는사람', email: 'reader@storyfork.demo', operator: false }
/** 로그인한 사용자로 계정 화면을 연다. `patch`로 닉네임 저장 응답 시점을 정한다. */
function setup(path: string, patch?: () => Promise<Response>) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (url.endsWith('/refresh')) return Response.json({ accessToken: 'token', user: me })
    if (url.endsWith('/sessions')) return Response.json({ sessions: [] })
    if (url.endsWith('/email-change')) return new Response(null, { status: 202 })
    if (url.endsWith('/me') && init?.method === 'PATCH' && patch) return patch()
    return Response.json(me)
  })
  vi.stubGlobal('fetch', fetch)
  const patches = () => fetch.mock.calls.filter(([url, init]) => url.endsWith('/me') && init?.method === 'PATCH')
  return { patches, ...renderApp(path, createAppStore({ role: 'user' })) }
}
const toastText = () => document.getElementById('toast')!.textContent
/** 브라우저가 disabled가 된 입력에서 초점을 거두는 것을 재현한다(jsdom은 disabled 요소의 blur()를 무시한다). */
function dropFocus() {
  const probe = document.body.appendChild(document.createElement('input'))
  probe.focus()
  probe.remove()
  expect(document.activeElement).toBe(document.body)
}

describe('프로필 폼 (U30)', () => {
  it('실제 폼이라 제출 이벤트(Enter 저장)로 저장하고 필수 입력을 표시한다', async () => {
    const { patches } = setup('/me/profile')
    const nick = await screen.findByLabelText<HTMLInputElement>('닉네임')
    const email = screen.getByLabelText<HTMLInputElement>('이메일')
    const form = nick.closest('form')
    expect(form).not.toBeNull()
    expect(screen.getByRole('button', { name: '저장' }).getAttribute('type')).toBe('submit')
    expect(nick.required).toBe(true)
    expect(email.required).toBe(true)
    fireEvent.change(nick, { target: { value: '새닉네임' } })
    fireEvent.submit(form!)
    await waitFor(() => expect(patches()).toHaveLength(1))
  })

  it('검증 오류를 해당 필드 옆 경고로 연결하고 첫 오류 필드로 초점을 보낸다', async () => {
    setup('/me/profile')
    const nick = await screen.findByLabelText<HTMLInputElement>('닉네임')
    const email = screen.getByLabelText<HTMLInputElement>('이메일')
    fireEvent.change(nick, { target: { value: '나' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    let alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('닉네임은 2자 이상이에요')
    expect(nick.getAttribute('aria-invalid')).toBe('true')
    expect(nick.getAttribute('aria-describedby')).toBe(alert.id)
    expect(email.getAttribute('aria-invalid')).not.toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(nick))
    expect(toastText()).toBe('닉네임은 2자 이상이에요')
    fireEvent.change(nick, { target: { value: '새닉네임' } })
    fireEvent.change(email, { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('이메일 형식을 확인해 주세요')
    expect(email.getAttribute('aria-invalid')).toBe('true')
    expect(email.getAttribute('aria-describedby')).toBe(alert.id)
    expect(nick.getAttribute('aria-invalid')).not.toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(email))
  })

  it('저장 성공은 토스트 말고도 상태 영역에 남긴다', async () => {
    setup('/me/profile')
    fireEvent.change(await screen.findByLabelText('닉네임'), { target: { value: '새닉네임' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.getAllByText('프로필을 저장했어요').some((el) => el.getAttribute('role') === 'status')).toBe(true))
  })

  it('저장 중에는 입력을 잠그고 중복 저장하지 않으며, 끝나면 잃은 초점을 제출하던 입력으로 돌려준다', async () => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    const { patches } = setup('/me/profile', () => pending)
    const nick = await screen.findByLabelText<HTMLInputElement>('닉네임')
    fireEvent.change(nick, { target: { value: '새닉네임' } })
    nick.focus()
    const form = nick.closest('form')!
    fireEvent.submit(form)
    const button = await screen.findByRole<HTMLButtonElement>('button', { name: '저장 중…' })
    expect(button.disabled).toBe(true)
    expect(nick.disabled).toBe(true)
    expect(form.getAttribute('aria-busy')).toBe('true')
    fireEvent.submit(form)
    expect(patches()).toHaveLength(1)
    dropFocus()
    await act(async () => { finish(Response.json({ ...me, nickname: '새닉네임' })) })
    await waitFor(() => expect(document.activeElement).toBe(nick))
    expect(nick.disabled).toBe(false)
  })
})

describe('문의하기 폼 (U34)', () => {
  const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label)

  it('제목·내용은 필수이고 비어 있으면 필드 옆 경고와 첫 오류 필드 초점을 준다', async () => {
    setup('/me/inquiry')
    await screen.findByRole('heading', { name: '문의하기' })
    expect(field('제목').required).toBe(true)
    expect(field('내용').required).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '문의 보내기' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('제목과 내용을 입력해 주세요')
    for (const label of ['제목', '내용']) {
      expect(field(label).getAttribute('aria-invalid')).toBe('true')
      expect(field(label).getAttribute('aria-describedby')).toBe(alert.id)
    }
    await waitFor(() => expect(document.activeElement).toBe(field('제목')))
    await waitFor(() => expect(toastText()).toBe('제목과 내용을 입력해 주세요'))
    fireEvent.change(field('제목'), { target: { value: '질문' } })
    expect(field('제목').getAttribute('aria-invalid')).not.toBe('true')
    expect(field('내용').getAttribute('aria-invalid')).toBe('true')
  })

  it('전송 중에는 버튼과 입력을 잠그고 중복 전송하지 않으며 결과를 상태 영역에 남긴다', async () => {
    let finish!: (result: { ok: boolean; msg: string }) => void
    const ask = vi.spyOn(appContainer.resolve('accountUseCase'), 'ask').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    setup('/me/inquiry')
    await screen.findByRole('heading', { name: '문의하기' })
    fireEvent.change(field('제목'), { target: { value: '포크 질문' } })
    fireEvent.change(field('내용'), { target: { value: '어떻게 하나요?' } })
    const form = document.getElementById('iqf') as HTMLFormElement
    fireEvent.submit(form)
    const button = await screen.findByRole<HTMLButtonElement>('button', { name: '보내는 중…' })
    expect(button.disabled).toBe(true)
    expect(form.getAttribute('aria-busy')).toBe('true')
    expect(field('제목').readOnly).toBe(true)
    fireEvent.submit(form)
    expect(ask).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ ok: true, msg: '문의를 보냈어요 (데모 · 실제 전송 없음)' }) })
    await waitFor(() => expect(screen.getAllByText('문의를 보냈어요 (데모 · 실제 전송 없음)').some((el) => el.getAttribute('role') === 'status')).toBe(true))
    expect(field('제목').value).toBe('')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '문의 보내기' }).disabled).toBe(false)
  })
})

describe('계정 화면 구조', () => {
  it('main#main과 h1 하나를 가지며 기존 섹션 제목은 유지한다', async () => {
    setup('/me/profile')
    const main = screen.getByRole('main')
    expect(main.id).toBe('main')
    expect(main.getAttribute('tabindex')).toBe('-1')
    await screen.findByRole('heading', { name: '프로필', level: 2 })
    expect(within(main).getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})

describe('계정 문서 제목', () => {
  it.each([
    ['/me/profile', '프로필'],
    ['/me/inquiry', '문의하기'],
    ['/me/notice', '공지사항'],
    ['/me/unknown', '계정'],
  ])('%s의 탭 제목은 하위 탭 이름(없으면 계정)이다', async (path, name) => {
    setup(path)
    await waitFor(() => expect(document.title).toBe(`${name} · STORYFORK`))
  })
})

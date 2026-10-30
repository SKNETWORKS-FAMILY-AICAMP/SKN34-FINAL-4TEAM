// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import App from './App'
import { createAppStore } from './app/store'

afterEach(cleanup)

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const sid = () => document.getElementById('sid')!.textContent
const toastIs = (t: string | RegExp) => waitFor(() => expect(document.getElementById('toast')!.textContent).toMatch(t))
const renderAt = (path: string, role: 'user' | null = 'user') => {
  const store = createAppStore({ role })
  return { store, ...render(<Provider store={store}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></Provider>) }
}

describe('계정 (U30~U35E)', () => {
  it('프로필은 닉네임 2자·이메일 형식을 확인하고 저장한다', async () => {
    renderAt('/me/profile')
    await screen.findByRole('heading', { name: '프로필' })
    expect(sid()).toContain('U30')
    const nick = screen.getByLabelText('닉네임'), email = screen.getByLabelText('이메일')
    fireEvent.change(nick, { target: { value: '나' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await toastIs('닉네임은 2자 이상이에요')
    fireEvent.change(nick, { target: { value: '새닉네임' } })
    fireEvent.change(email, { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await toastIs('이메일 형식을 확인해 주세요')
    fireEvent.change(email, { target: { value: 'new@storyfork.demo' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await toastIs('프로필을 저장했어요')
    within(screen.getByRole('navigation', { name: '계정 메뉴' })).getByText('new@storyfork.demo')
    expect(within(screen.getByRole('navigation', { name: '계정 메뉴' })).queryByRole('button', { name: '로그아웃' })).toBeNull()
  })

  it('회원탈퇴는 30일 유예를 안내하고 실제로 바꾸지 않는다', async () => {
    const { store } = renderAt('/me/profile')
    fireEvent.click(await screen.findByRole('button', { name: '회원탈퇴' }))
    const sheet = await screen.findByRole('dialog', { name: '회원탈퇴' })
    within(sheet).getByText(/탈퇴 후 30일 동안 작품·세계관을 숨기며, 다시 로그인하면 복구할 수 있어요\..*이 데모에서는 실제 탈퇴나 데이터 변경이 일어나지 않아요\./)
    fireEvent.click(within(sheet).getByRole('button', { name: '탈퇴하기' }))
    await toastIs('확인 항목에 체크해 주세요')
    fireEvent.click(within(sheet).getByLabelText('위 내용을 확인했어요'))
    fireEvent.click(within(sheet).getByRole('button', { name: '탈퇴하기' }))
    await toastIs('탈퇴 확인 데모예요. 실제 계정은 변경되지 않았어요')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(store.getState().session.role).toBe('user')
  })

  it('저장 공간은 MVP 제외를 안내하고 발행 회차 수정 초안을 보여 준다', async () => {
    renderAt('/studio/starlight?ep=1')
    const body = await screen.findByLabelText('원고 본문')
    body.innerHTML = '<p>수정 초안</p>'
    fireEvent.input(body)
    await waitFor(() => expect(document.getElementById('saved')!.textContent).toBe('저장 중…'))
    cleanup()
    renderAt('/me/storage')
    await screen.findByText(/저장 공간 관리는 MVP에서 제외됐어요/)
    await screen.findByText('별빛 서약의 탑 · 1화 수정 초안')
    expect(document.querySelector('[data-storage-delete]')).toBeNull()
  })

  it('문의를 보내면 답변 대기로 쌓인다', async () => {
    renderAt('/me/inquiry')
    await screen.findByRole('heading', { name: '문의하기' })
    expect(sid()).toContain('U34')
    fireEvent.click(screen.getByRole('button', { name: '문의 보내기' }))
    await toastIs('제목과 내용을 입력해 주세요')
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '포크 질문' } })
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '어떻게 하나요?' } })
    fireEvent.click(screen.getByRole('button', { name: '문의 보내기' }))
    await toastIs('문의를 보냈어요 (데모 · 실제 전송 없음)')
    const q = await screen.findByText('[이용 문의] 포크 질문')
    within(q.closest('.rp') as HTMLElement).getByText('답변 대기')
  })

  it('로그인 전에는 보호 메뉴가 로그인으로 가고, 회원가입은 필수 약관을 확인한다', async () => {
    renderAt('/me/profile', null)
    await waitFor(() => expect(where()).toBe('/login'))
    cleanup()
    renderAt('/me/signup', null)
    await screen.findByRole('heading', { name: '회원가입' })
    expect(sid()).toContain('U31')
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'me@storyfork.demo' } })
    fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: '새독자' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText('비밀번호 확인'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: '가입하고 시작하기' }))
    await toastIs('필수 약관에 동의해 주세요')
    fireEvent.click(screen.getByLabelText('전체 동의'))
    expect(screen.getByLabelText<HTMLInputElement>('[필수] 이용약관 동의').checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '가입하고 시작하기' }))
    await toastIs('가입을 환영해요, 새독자님')
    await waitFor(() => expect(where()).toBe('/'))
  })

  it('공지와 이벤트를 상세까지 연다', async () => {
    renderAt('/me/notice', null)
    fireEvent.click(await screen.findByRole('link', { name: /포크 이용 안내/ }))
    await screen.findByRole('heading', { name: '포크 이용 안내' })
    cleanup()
    renderAt('/me/event', null)
    await waitFor(() => expect(sid()).toContain('U35E'))
    screen.getByText('보상·경품은 정해지지 않았어요. 이벤트는 기능 체험 안내예요.')
  })
})

// @vitest-environment jsdom
import '../fixtureApp'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '../scrollToSpy'
import App from '../../App'
import { createAppStore } from '../../app/store'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const sid = () => document.getElementById('sid')!.textContent
const toastIs = (t: string | RegExp) => waitFor(() => expect(document.getElementById('toast')!.textContent).toMatch(t))
const renderAt = (path: string, role: 'user' | 'admin' | null = 'admin', store = createAppStore({ role })) => {
  return { store, ...render(<Provider store={store}><MemoryRouter initialEntries={[path]} useTransitions={false}><App /><Where /></MemoryRouter></Provider>) }
}
const nav = () => screen.getByRole('navigation', { name: '관리자 업무' })

describe('관리자 (A01~A18)', () => {
  it('관리자 화면에서 로그아웃하면 홈으로 가고 로그인 안내가 남지 않는다 (목업 logout)', async () => {
    vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: object, callback: (lock: object) => Promise<unknown>) => callback({}) } })
    const fetch = vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'csrf' })
      : path.endsWith('/refresh') ? Response.json({ accessToken: 'token', user: { id: 'admin', email: 'admin@example.invalid', nickname: '관리자', operator: true } })
        : new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const { store } = renderAt('/admin')
    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }))
    await toastIs('로그아웃했어요')
    await waitFor(() => expect(where()).toBe('/'))
    expect(store.getState().session).toMatchObject({ role: null, next: null, loginMsg: '' })
    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'same-origin', headers: expect.objectContaining({ 'X-CSRF-TOKEN': 'csrf', 'X-Auth-User': 'admin' }) }))
  })

  it('일반 회원·비로그인은 관리자 로그인 안내로 보낸다', async () => {
    const { store } = renderAt('/admin?tab=users', 'user')
    await waitFor(() => expect(where()).toBe('/login'))
    expect(store.getState().session).toMatchObject({ next: '/admin?tab=users', loginRole: 'admin', loginMsg: '관리자 화면은 관리자 계정으로 로그인해야 볼 수 있어요.' })
    cleanup()
    renderAt('/admin', null)
    await waitFor(() => expect(where()).toBe('/login'))
  })

  it('탭 이동: 현재 탭 표시, tab=ai는 LLM Ops, 모르는 탭은 개요', async () => {
    renderAt('/admin?tab=nope')
    await screen.findByRole('heading', { name: '관리 개요' })
    expect(sid()).toContain('A01')
    expect(within(document.querySelector<HTMLElement>('.priority-links')!).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/admin?tab=feedback', '/admin?tab=rights'])
    expect(within(nav()).getByRole('link', { name: '개요' }).getAttribute('aria-current')).toBe('page')
    screen.getByText('데모 화면')
    expect(document.querySelector('.gnb')).toBeNull()
    cleanup()
    renderAt('/admin?tab=ai')
    await screen.findByRole('heading', { name: 'LLM Ops' })
    expect(sid()).toContain('A05')
    fireEvent.click(within(nav()).getByRole('link', { name: '사용자' }))
    await screen.findByRole('heading', { name: '사용자 관리' })
    expect(where()).toBe('/admin?tab=users')
    expect(sid()).toContain('A07')
  })

  it('댓글 관리에서 숨긴 댓글은 회차 뷰어 목록·개수에서 빠지고 게시 복구하면 돌아온다 (목업 reader() cms)', async () => {
    const text = '돌다리 장면 묘사 최고… 성진 흔들릴 만하네'
    const readerCount = async () => { cleanup(); renderAt('/read/guunmong/1', 'user'); return (await screen.findByRole('heading', { name: /^댓글 \d+$/ })).textContent }
    const before = await readerCount()
    expect(screen.queryByText(text)).not.toBeNull()
    const toggle = async () => {
      cleanup(); renderAt('/admin?tab=comments')
      fireEvent.click(within((await screen.findByText(text)).closest('tr') as HTMLElement).getByRole('button'))
      await toastIs('댓글 상태를 변경했어요 (데모)')
    }
    await toggle()
    expect(await readerCount()).toBe('댓글 ' + (Number(before!.split(' ')[1]) - 1))
    expect(screen.queryByText(text)).toBeNull()
    await toggle()
    expect(await readerCount()).toBe(before)
    expect(screen.queryByText(text)).not.toBeNull()
  })

  it('공지·이벤트를 게시하면 회원 화면에 보인다', async () => {
    renderAt('/admin?tab=notices')
    fireEvent.click(await screen.findByText('기존 회원 화면 공지 데모'))
    expect((await screen.findByLabelText<HTMLInputElement>('제목')).required).toBe(true)
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '점검 안내' } })
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '오늘 밤 점검해요' } })
    fireEvent.click(screen.getByRole('button', { name: '공지 게시' }))
    await toastIs('공지를 게시했어요 (데모 · 현재 화면에만 반영)')
    fireEvent.click(within(nav()).getByRole('link', { name: '이벤트' }))
    // 이벤트는 운영 API(대역: 메모리 저장소)로 등록하고, 회원 화면은 같은 공개 API로 읽는다.
    fireEvent.click(await screen.findByRole('button', { name: '이벤트 작성' }))
    fireEvent.change(await screen.findByLabelText('이벤트 제목'), { target: { value: '새 이벤트' } })
    fireEvent.change(screen.getByLabelText('이벤트 내용'), { target: { value: '참여해 보세요' } })
    fireEvent.click(screen.getByRole('button', { name: '이벤트 저장' }))
    await toastIs('이벤트를 등록했어요.')
    await screen.findByRole('heading', { name: '새 이벤트' })
    within(screen.getByRole('region', { name: '운영 이벤트' })).getByText('상시')
    cleanup()
    renderAt('/me/notice', 'user')
    await screen.findByRole('link', { name: /점검 안내/ })
    cleanup()
    renderAt('/me/event', 'user')
    await screen.findByText('새 이벤트')
    screen.getByText('상시')
  })

  it('문의에 답변하면 회원 문의 목록에 운영팀 답변이 보인다', async () => {
    renderAt('/me/inquiry', 'user')
    fireEvent.change(await screen.findByLabelText('제목'), { target: { value: '답변 요청' } })
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '확인 부탁해요' } })
    fireEvent.click(screen.getByRole('button', { name: '문의 보내기' }))
    await screen.findByText('[이용 문의] 답변 요청')
    cleanup()
    renderAt('/admin?tab=feedback')
    fireEvent.click(await screen.findByText('기존 회원 문의 데모'))
    fireEvent.click(await screen.findByRole('button', { name: /답변 요청.*답변 대기/ }))
    const item = (await screen.findByRole('heading', { name: '[이용 문의] 답변 요청' })).closest('article') as HTMLElement
    fireEvent.change(within(item).getByLabelText('답변'), { target: { value: '확인했어요' } })
    fireEvent.click(within(item).getByRole('button', { name: '답변 등록' }))
    await toastIs('답변을 등록했어요 (데모 · 실제 전송 없음)')
    cleanup()
    renderAt('/me/inquiry', 'user')
    const q = (await screen.findByText('[이용 문의] 답변 요청')).closest('.rp') as HTMLElement
    within(q).getByText('답변 완료')
    within(q).getByText('확인했어요')
  })

  it('실패한 정기 작업은 수동 재시도 시연만 기록한다', async () => {
    renderAt('/admin?tab=jobs')
    const row = (await screen.findByText('알림 90일 보관기간 정리')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '수동 재시도 시연' }))
    await toastIs('실패 작업의 수동 재시도 흐름을 기록했어요 (실제 작업은 실행하지 않음)')
    await within(row).findByText('수동 재시도 흐름 시연 · 실제 작업 없음')
  })

  it('분류·캐릭터챗 입력은 다른 화면에 갔다 와도 유지된다 (목업 S.admin.filters·chatForm)', async () => {
    const { store } = renderAt('/admin?tab=characterChats')
    await screen.findByLabelText('작품 유형')
    fireEvent.click(within(nav()).getByRole('link', { name: '캐릭터챗' }))
    const kind = await screen.findByLabelText('작품 유형') as HTMLSelectElement
    fireEvent.change(kind, { target: { value: 'original' } })
    fireEvent.click(within(nav()).getByRole('link', { name: '작품' }))
    const cat = await screen.findByLabelText('분류') as HTMLSelectElement
    fireEvent.change(cat, { target: { value: 'fork' } })
    cleanup()
    renderAt('/admin?tab=characterChats', 'admin', store)
    expect((await screen.findByLabelText('작품 유형') as HTMLSelectElement).value).toBe('original')
    fireEvent.click(within(nav()).getByRole('link', { name: '작품' }))
    expect((await screen.findByLabelText('분류') as HTMLSelectElement).value).toBe('fork')
  })

  it('프로필 탭은 로그인한 계정을 보여 주고 변경은 회원 계정 화면으로 보낸다', async () => {
    const { store } = renderAt('/admin?tab=profile')
    const { nick, email } = store.getState().session.user
    await screen.findByText(nick, { selector: '.mehead b' })
    screen.getByText(`${email} · 관리자 계정`)
    expect(screen.getByRole('link', { name: '닉네임·이메일 변경' }).getAttribute('href')).toBe('/me/profile')
    expect(screen.queryByRole('button', { name: '프로필 저장' })).toBeNull()
  })
})

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
const renderAt = (path: string, role: 'user' | 'admin' | null = 'admin', store = createAppStore({ role })) => {
  return { store, ...render(<Provider store={store}><MemoryRouter initialEntries={[path]} useTransitions={false}><App /><Where /></MemoryRouter></Provider>) }
}
const nav = () => screen.getByRole('navigation', { name: '관리자 업무' })

describe('관리자 (A01~A18)', () => {
  it('관리자 화면에서 로그아웃하면 홈으로 가고 로그인 안내가 남지 않는다 (목업 logout)', async () => {
    const { store } = renderAt('/admin')
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    await toastIs('로그아웃했어요')
    await waitFor(() => expect(where()).toBe('/'))
    expect(store.getState().session).toMatchObject({ role: null, next: null, loginMsg: '' })
  })

  it('일반 회원·비로그인은 관리자 로그인 안내로 보낸다', async () => {
    const { store } = renderAt('/admin?tab=users', 'user')
    await waitFor(() => expect(where()).toBe('/login'))
    expect(store.getState().session).toMatchObject({ next: '/admin', loginRole: 'admin', loginMsg: '관리자 화면은 관리자 계정으로 로그인해야 볼 수 있어요.' })
    cleanup()
    renderAt('/admin', null)
    await waitFor(() => expect(where()).toBe('/login'))
  })

  it('탭 이동: 현재 탭 표시, tab=ai는 LLM Ops, 모르는 탭은 개요', async () => {
    renderAt('/admin?tab=nope')
    await screen.findByRole('heading', { name: '관리 개요' })
    expect(sid()).toContain('A01')
    expect(within(nav()).getByRole('button', { name: '개요' }).getAttribute('aria-current')).toBe('page')
    screen.getByText('이 관리자 UI는 오프라인 데모입니다. 실제 권한 확인과 데이터 반영은 서버 연결이 필요합니다.')
    expect(document.querySelector('.gnb')).toBeNull()
    cleanup()
    renderAt('/admin?tab=ai')
    await screen.findByRole('heading', { name: 'LLM Ops' })
    expect(sid()).toContain('A05')
    fireEvent.click(within(nav()).getByRole('button', { name: '사용자' }))
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

  it('사용자 이용 제한은 활동 로그에 남는다', async () => {
    renderAt('/admin?tab=users')
    const row = (await screen.findByText('연화봉러')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '이용 제한' }))
    await toastIs('사용자 상태를 변경했어요 (데모)')
    await within(row).findByRole('button', { name: '제한 해제' })
    fireEvent.click(within(nav()).getByRole('button', { name: '활동 로그' }))
    await screen.findByText('사용자 상태 변경')
    screen.getByText('관리자 · 연화봉러 · 제한')
  })

  it('공지·이벤트를 게시하면 회원 화면에 보인다', async () => {
    renderAt('/admin?tab=notices')
    expect((await screen.findByLabelText<HTMLInputElement>('제목')).required).toBe(true)
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '점검 안내' } })
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '오늘 밤 점검해요' } })
    fireEvent.click(screen.getByRole('button', { name: '공지 게시' }))
    await toastIs('공지를 게시했어요 (데모 · 현재 화면에만 반영)')
    fireEvent.click(within(nav()).getByRole('button', { name: '이벤트' }))
    fireEvent.change(await screen.findByLabelText('이벤트명'), { target: { value: '새 이벤트' } })
    fireEvent.change(screen.getByLabelText('안내 내용'), { target: { value: '참여해 보세요' } })
    fireEvent.click(screen.getByRole('button', { name: '이벤트 추가' }))
    await toastIs('이벤트를 추가했어요 (데모 · 현재 화면에만 반영)')
    const row = (await screen.findByText('새 이벤트')).closest('tr') as HTMLElement
    within(row).getByText('기간 미정')
    fireEvent.click(within(row).getByRole('button', { name: '상태 변경' }))
    await within(row).findByText('진행 중')
    cleanup()
    renderAt('/me/notice', 'user')
    await screen.findByRole('link', { name: /점검 안내/ })
    cleanup()
    renderAt('/me/event', 'user')
    await screen.findByText('새 이벤트')
  })

  it('문의에 답변하면 회원 문의 목록에 운영팀 답변이 보인다', async () => {
    renderAt('/me/inquiry', 'user')
    fireEvent.change(await screen.findByLabelText('제목'), { target: { value: '답변 요청' } })
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '확인 부탁해요' } })
    fireEvent.click(screen.getByRole('button', { name: '문의 보내기' }))
    await screen.findByText('[이용 문의] 답변 요청')
    cleanup()
    renderAt('/admin?tab=feedback')
    const item = (await screen.findByText('[이용 문의] 답변 요청')).closest('article') as HTMLElement
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

  it('신고·권리: 제한 작품 상세에서 증빙을 요청한다', async () => {
    renderAt('/admin?tab=rights')
    expect(sid()).toContain('A03')
    fireEvent.click((await screen.findByText('○○○ 2차 연재')).closest('tr')!)
    await screen.findByText('신고 상세 · ○○○ 2차 연재')
    await waitFor(() => expect(sid()).toContain('A04'))
    fireEvent.click(screen.getByRole('button', { name: '증빙 요청' }))
    await toastIs('조치를 기록했어요 (데모)')
    await screen.findByText(/등록자에게 권리 증빙 요청/)
  })

  it('신고 행 선택·분류·캐릭터챗 입력은 다른 화면에 갔다 와도 유지된다 (목업 S.admin.sel·filters·chatForm)', async () => {
    const { store } = renderAt('/admin?tab=rights')
    fireEvent.click((await screen.findByText('○○○ 2차 연재')).closest('tr')!)
    await screen.findByText('신고 상세 · ○○○ 2차 연재')
    cleanup()
    renderAt('/', 'admin', store)
    cleanup()
    renderAt('/admin?tab=rights', 'admin', store)
    await screen.findByText('신고 상세 · ○○○ 2차 연재')
    await waitFor(() => expect(sid()).toContain('A04'))

    fireEvent.click(within(nav()).getByRole('button', { name: '캐릭터챗' }))
    const kind = await screen.findByLabelText('작품 유형') as HTMLSelectElement
    fireEvent.change(kind, { target: { value: 'original' } })
    fireEvent.click(within(nav()).getByRole('button', { name: '작품' }))
    const cat = await screen.findByLabelText('분류') as HTMLSelectElement
    fireEvent.change(cat, { target: { value: 'fork' } })
    cleanup()
    renderAt('/admin?tab=characterChats', 'admin', store)
    expect((await screen.findByLabelText('작품 유형') as HTMLSelectElement).value).toBe('original')
    fireEvent.click(within(nav()).getByRole('button', { name: '작품' }))
    expect((await screen.findByLabelText('분류') as HTMLSelectElement).value).toBe('fork')
  })

  it('프로필 이메일 형식을 확인하고 상단바 이름을 바꾼다', async () => {
    renderAt('/admin?tab=profile')
    const nick = await screen.findByLabelText('닉네임')
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'bad@x' } })
    fireEvent.click(screen.getByRole('button', { name: '프로필 저장' }))
    await toastIs('이메일 형식을 확인해 주세요')
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'ops@storyfork.demo' } })
    fireEvent.change(nick, { target: { value: '운영자' } })
    fireEvent.click(screen.getByRole('button', { name: '프로필 저장' }))
    await toastIs('프로필을 저장했어요 (데모 · 현재 화면에만 반영)')
    await screen.findByRole('button', { name: '운영자 · 프로필' })
  })
})

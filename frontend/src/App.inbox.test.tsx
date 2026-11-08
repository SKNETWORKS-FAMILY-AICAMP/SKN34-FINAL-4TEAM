// @vitest-environment jsdom
import './test/fixtureApp'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import type { AppNotification } from './domain/entities/notification'
import { appContainer } from './app/appContainer'
import { createAppStore } from './app/store'
import { sessionActions } from './presentation/shared/session/sessionSlice'

afterEach(cleanup)

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const sid = () => document.getElementById('sid')!.textContent
const toastIs = (t: string | RegExp) => waitFor(() => expect(document.getElementById('toast')!.textContent).toMatch(t))
const renderAt = (path: string) => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></Provider>)
const renderWith = (store: ReturnType<typeof createAppStore>, path = '/notifications') => render(<Provider store={store}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></Provider>)
const feedback = () => appContainer.resolve('feedbackRepository')
const item = (id: string, patch: object) => ({ id, rid: 'r-' + id, w: 'starlight', n: 1, pi: 0, type: '질문', who: '독자', text: '제보 ' + id, baseText: '', status: '작가 검토 대기', ai: { cls: '제안', why: '안내', ev: '문장' }, ...patch })

const notice = (id: string, patch: Partial<AppNotification> = {}): AppNotification => ({ id, kind: 'creation', summary: '알림 ' + id, targetType: 'work', targetId: 'starlight', createdAt: '2026-11-05T03:00:00Z', read: false, ...patch })
/** 인증된 Core API 대신 Repository 메서드를 가로채 화면 동작만 검증합니다(HTTP 계약은 HttpNotificationRepository 테스트가 확인). */
function backend(items: AppNotification[], nextCursor: string | null = null) {
  const repo = appContainer.resolve('notificationRepository')
  const state = { items: [...items], prefs: { read: true, creator: true } }
  return {
    state,
    list: vi.spyOn(repo, 'list').mockImplementation(async (cursor) => (cursor ? { items: [notice('older', { createdAt: '2026-11-04T03:00:00Z', read: true })], nextCursor: null } : { items: state.items, nextCursor })),
    count: vi.spyOn(repo, 'unreadCount').mockImplementation(async () => state.items.filter((n) => !n.read).length),
    prefs: vi.spyOn(repo, 'getPrefs').mockImplementation(async () => ({ ...state.prefs })),
    save: vi.spyOn(repo, 'savePrefs').mockImplementation(async (p) => { state.prefs = p; return p }),
    read: vi.spyOn(repo, 'markRead').mockImplementation(async (id) => { state.items = state.items.map((n) => (n.id === id ? { ...n, read: true } : n)) }),
    readAll: vi.spyOn(repo, 'markAllRead').mockImplementation(async (upTo) => { state.items = state.items.map((n) => (n.createdAt <= upTo ? { ...n, read: true } : n)) }),
    remove: vi.spyOn(repo, 'remove').mockImplementation(async (id) => { state.items = state.items.filter((n) => n.id !== id) }),
  }
}
afterEach(() => vi.restoreAllMocks())

describe('알림함 (U42)', () => {
  it('필수 알림 안내를 보여 주고 90일 자동 삭제를 말하지 않는다', async () => {
    backend([notice('a')])
    renderAt('/notifications')
    await screen.findByRole('heading', { name: '알림함' })
    expect(sid()).toContain('U42')
    screen.getByText(/결과·크레딧·권리·보안 알림은 필수 알림이에요\. 알림은 앱 안에서만 확인할 수 있고, 직접 삭제하기 전까지 보관해요\./)
    expect(document.body.textContent).not.toMatch('90일')
    await screen.findByText('알림 a')
  })

  it('모두 읽음은 보이는 최신 알림 시각을 upTo로 보내고 GNB 배지가 사라진다', async () => {
    const b = backend([notice('a'), notice('b', { createdAt: '2026-11-05T02:00:00Z' })])
    renderAt('/notifications')
    await screen.findByRole('link', { name: '알림함, 읽지 않은 알림 2건' })
    fireEvent.click(screen.getByRole('button', { name: '모두 읽음' }))
    await waitFor(() => expect(b.readAll).toHaveBeenCalledWith('2026-11-05T03:00:00Z'))
    await screen.findByRole('link', { name: '알림함' })
    expect(screen.getByRole('button', { name: '모두 읽음' })).toHaveProperty('disabled', true)
  })

  it('모두 읽음은 시각 문자열을 비교하지 않고 서버가 준 가장 최신 알림의 시각을 그대로 보낸다', async () => {
    // 소수부 자릿수가 달라도(.500123Z가 .5Z보다 늦다) 첫(최신) 알림의 값을 쓴다.
    const b = backend([notice('a', { createdAt: '2026-11-05T03:00:00.500123Z' }), notice('b', { createdAt: '2026-11-05T03:00:00.5Z' })])
    // 서버는 upTo 이전(포함) 알림을 모두 읽음으로 바꿉니다(여기서는 둘 다 해당).
    b.readAll.mockImplementation(async () => { b.state.items = b.state.items.map((n) => ({ ...n, read: true })) })
    renderAt('/notifications')
    await screen.findByRole('link', { name: '알림함, 읽지 않은 알림 2건' })
    fireEvent.click(screen.getByRole('button', { name: '모두 읽음' }))
    await waitFor(() => expect(b.readAll).toHaveBeenCalledWith('2026-11-05T03:00:00.500123Z'))
    await screen.findByRole('link', { name: '알림함' })
  })

  it('화면을 떠나면 진행 중인 조회 요청을 취소한다', async () => {
    const b = backend([notice('a')])
    renderAt('/notifications')
    await screen.findByText('알림 a')
    const signal = b.list.mock.calls[0][1] as AbortSignal
    expect(signal.aborted).toBe(false)
    cleanup()
    expect(signal.aborted).toBe(true)
  })

  it('알림을 누르면 읽음 처리하고 대상 화면으로 간다', async () => {
    const b = backend([notice('a')])
    renderAt('/notifications')
    fireEvent.click(await screen.findByRole('button', { name: /^알림 a\b/ }))
    await waitFor(() => expect(where()).toBe('/work/starlight'))
    expect(b.read).toHaveBeenCalledWith('a')
  })

  it('이동할 대상을 모르는 알림은 읽음만 처리하고 이동하지 않는다', async () => {
    backend([notice('a', { kind: 'credit', targetType: null, targetId: null })])
    renderAt('/notifications')
    fireEvent.click(await screen.findByRole('button', { name: /^알림 a\b/ }))
    await screen.findByText(/읽음$/)
    expect(where()).toBe('/notifications')
  })

  it('삭제하면 목록에서 사라진다', async () => {
    const b = backend([notice('a'), notice('b')])
    renderAt('/notifications')
    fireEvent.click(await screen.findByRole('button', { name: '알림 삭제: 알림 a' }))
    await waitFor(() => expect(screen.queryByText('알림 a')).toBeNull())
    expect(b.remove).toHaveBeenCalledWith('a')
    screen.getByText('알림 b')
  })

  it('더 보기는 cursor로 다음 페이지를 이어 붙인다', async () => {
    const b = backend([notice('a')], 'next-1')
    renderAt('/notifications')
    fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
    await screen.findByText('알림 older')
    expect(b.list.mock.lastCall?.[0]).toBe('next-1')
    expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
  })

  it('수신 설정을 저장하면 서버가 돌려준 값으로 맞춘다', async () => {
    const b = backend([notice('a')])
    renderAt('/notifications')
    fireEvent.click(await screen.findByLabelText('작가 소식'))
    await waitFor(() => expect(b.save).toHaveBeenCalledWith({ read: true, creator: false }))
    await waitFor(() => expect((screen.getByLabelText('작가 소식') as HTMLInputElement).checked).toBe(false))
  })

  it('설정 저장에 실패하면 안내하고 값을 바꾸지 않는다', async () => {
    const b = backend([notice('a')])
    renderAt('/notifications')
    const box = await screen.findByLabelText('읽기 알림')
    b.save.mockRejectedValueOnce(new Error('fail'))
    fireEvent.click(box)
    await toastIs('알림 설정을 저장하지 못했어요. 다시 시도해 주세요.')
    expect((screen.getByLabelText('읽기 알림') as HTMLInputElement).checked).toBe(true)
  })

  it('불러오기에 실패하면 오류와 다시 시도를 보여 주고, 재시도하면 목록을 보여 준다', async () => {
    const b = backend([notice('a')])
    b.list.mockRejectedValueOnce(new Error('down'))
    renderAt('/notifications')
    await screen.findByText(/알림을 불러오지 못했어요/)
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await screen.findByText('알림 a')
  })

  it('실시간 변경 신호를 받으면 화면을 비우지 않고 새 알림을 합치고 배지를 갱신한다', async () => {
    const b = backend([notice('a', { read: true })])
    const store = createAppStore({ role: 'user' })
    renderWith(store)
    await screen.findByText('알림 a')
    await waitFor(() => expect(store.getState().session.noticeStream).toBe('off'))
    b.state.items = [notice('b', { createdAt: '2026-11-05T04:00:00Z' }), notice('a', { read: true })]
    act(() => { store.dispatch(sessionActions.noticeSignal()) })
    await screen.findByText('알림 b')
    screen.getByText('알림 a')
    await screen.findByRole('link', { name: '알림함, 읽지 않은 알림 1건' })
  })

  it('신호로 다시 받아도 이미 불러온 오래된 알림은 유지하고, 다른 곳에서 삭제한 알림은 사라진다', async () => {
    const b = backend([notice('a', { createdAt: '2026-11-05T03:00:00Z' }), notice('c', { createdAt: '2026-11-05T01:00:00Z' })], 'next-1')
    const store = createAppStore({ role: 'user' })
    renderWith(store)
    fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
    await screen.findByText('알림 older')
    b.state.items = [notice('c', { createdAt: '2026-11-05T01:00:00Z' })]
    act(() => { store.dispatch(sessionActions.noticeSignal()) })
    await waitFor(() => expect(screen.queryByText('알림 a')).toBeNull())
    screen.getByText('알림 older')
    screen.getByText('알림 c')
  })

  it('실시간 연결이 끊기면 안내를 보여 주고 목록은 그대로 쓸 수 있다', async () => {
    backend([notice('a')])
    const store = createAppStore({ role: 'user' })
    renderWith(store)
    await screen.findByText('알림 a')
    await waitFor(() => expect(store.getState().session.noticeStream).toBe('off'))
    act(() => { store.dispatch(sessionActions.noticeStreamState('offline')) })
    await screen.findByText(/실시간 연결이 끊겼어요/)
    screen.getByText('알림 a')
    act(() => { store.dispatch(sessionActions.noticeStreamState('live')) })
    await waitFor(() => expect(screen.queryByText(/실시간 연결이 끊겼어요/)).toBeNull())
  })

  it('알림이 없으면 빈 상태를 보여 준다', async () => {
    backend([])
    renderAt('/notifications')
    await screen.findByText('새 알림이 없어요.')
  })
})

describe('독자 피드백함 (U20)', () => {
  it('답변을 보내면 처리 완료가 되고 서재 배지와 독자 기록이 바뀐다', async () => {
    await feedback().addReport({ id: 'r-a', w: 'starlight', n: 1, type: '질문', text: '제보 a', status: '작가 검토 대기', reply: '' })
    await feedback().addInbox(item('a', {}))
    renderAt('/inbox')
    await screen.findByRole('heading', { name: /독자 피드백함/ })
    expect(sid()).toContain('U20')
    await screen.findByRole('link', { name: '내 서재, 처리할 독자 제보 1건' })
    fireEvent.change(screen.getByLabelText('작가 답변'), { target: { value: '의도한 복선이에요' } })
    fireEvent.click(screen.getByRole('button', { name: '답변 보내기' }))
    await toastIs('처리했어요 (데모)')
    await waitFor(() => expect(screen.queryByRole('link', { name: /처리할 독자 제보/ })).toBeNull())
    cleanup()
    renderAt('/lib?tab=qa')
    const rep = await screen.findByText('🤖 작가 답변: 의도한 복선이에요')
    within(rep.closest('.rp') as HTMLElement).getByText('처리 완료')
  })

  it('수정 제안은 승인한 뒤 따로 발행해야 원고가 바뀐다', async () => {
    const works = await appContainer.resolve('workRepository').listWorks()
    const text = works.find((w) => w.id === 'starlight')!.eps[0].p[0]
    const from = text.slice(0, 4)
    await feedback().addInbox(item('b', { type: '단순 오류', status: '수정 제안', from, to: '바뀐말', baseText: text }))
    renderAt('/inbox?i=b')
    fireEvent.click(await screen.findByRole('button', { name: '수정안 승인' }))
    await toastIs('수정안을 승인했어요. 발행은 별도로 확인해 주세요')
    fireEvent.click(await screen.findByRole('button', { name: '수정안 발행' }))
    await toastIs('수정안을 발행했어요 (데모)')
    const after = (await appContainer.resolve('workRepository').listWorks()).find((w) => w.id === 'starlight')!.eps[0].p[0]
    expect(after).toBe(text.replace(from, '바뀐말'))
  })
})

describe('권리 신고 소명 (data-appeal-form)', () => {
  it('비공개 조치된 내 작품에 소명을 제출한다', async () => {
    await feedback().addReview({ id: 'q1', w: 'starlight', n: null, type: '권리 침해', text: '무단 사용 의심', quote: '', status: '비공개 조치', who: '신고자' })
    renderAt('/lib?tab=write')
    const form = await screen.findByRole('form', { name: '별빛 서약의 탑 · 권리 신고 소명' })
    fireEvent.change(within(form).getByLabelText('소명 내용'), { target: { value: '   ' } })
    fireEvent.click(within(form).getByRole('button', { name: '소명 제출' }))
    await toastIs('소명 내용을 입력해 주세요')
    fireEvent.change(within(form).getByLabelText('소명 내용'), { target: { value: '직접 쓴 원고예요' } })
    fireEvent.click(within(form).getByRole('button', { name: '소명 제출' }))
    await toastIs('소명을 제출했어요 (데모)')
    await waitFor(() => expect(screen.queryByRole('form', { name: '별빛 서약의 탑 · 권리 신고 소명' })).toBeNull())
  })
})

describe('캐릭터 챗 (U27)', () => {
  it('목록에서 인물을 골라 읽은 회차까지만 대답한다', async () => {
    renderAt('/chat')
    await screen.findByRole('heading', { name: '캐릭터챗' })
    expect(sid()).toContain('U27')
    fireEvent.click(within(screen.getByRole('navigation', { name: '작품 유형' })).getByRole('link', { name: '포크' }))
    await waitFor(() => expect(where()).toContain('kind=fork'))
    fireEvent.click(within(screen.getByRole('navigation', { name: '작품 유형' })).getByRole('link', { name: '전체' }))
    fireEvent.click(await screen.findByRole('link', { name: /^성진 .*구운몽/ }))
    await waitFor(() => expect(where()).toBe('/chat/guunmong/%EC%84%B1%EC%A7%84'))
    await screen.findByText('소승 성진이라 합니다. 무엇이 궁금하십니까?')
    fireEvent.click(screen.getByRole('button', { name: '용궁에서 왜 술을 마셨어요?' }))
    await screen.findByText('근거 · 1화')
    fireEvent.click(screen.getByRole('button', { name: '🔒 스승님께 벌을 받고 어떤 마음이었어요?' }))
    await screen.findByText('그건 아직 말할 수 없어요. 3화를 읽고 다시 물어봐 주세요.')
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    await toastIs('물어볼 내용을 입력해 주세요')
    screen.getByRole('link', { name: /2화에서 포크하기/ })
  })
})

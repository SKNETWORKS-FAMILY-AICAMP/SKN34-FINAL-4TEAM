// @vitest-environment jsdom
import '../fixtureApp'
import '../testLocks'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '../scrollToSpy'
import App from '../../App'
import { appContainer } from '../../app/appContainer'
import { createAppStore } from '../../app/store'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const toastIs = (t: string | RegExp) => waitFor(() => expect(document.getElementById('toast')!.textContent).toMatch(t))
const renderAt = (path: string, role: 'user' | null = 'user') => {
  let user = { id: '1', nickname: '읽는사람', email: 'reader@storyfork.demo', operator: false }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (url.endsWith('/refresh')) return role ? Response.json({ accessToken: 'token', user }) : new Response(null, { status: 401 })
    if (url.endsWith('/email-change')) return new Response(null, { status: 202 })
    if (url.endsWith('/me') && init?.method === 'PATCH') user = { ...user, ...JSON.parse(String(init.body)) }
    return Response.json(user)
  }))
  const store = createAppStore({ role })
  return { store, ...render(<Provider store={store}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></Provider>) }
}

describe('계정 (U30~U35E)', () => {
  it('계정 메뉴는 현재 위치와 펼침 상태를 표시하고 선택하면 접는다', async () => {
    renderAt('/me/profile')
    await screen.findByLabelText('닉네임')
    let nav = screen.getByRole('navigation', { name: '계정 메뉴' })
    let toggle = within(nav).getByRole('button', { name: '계정 메뉴 열기' })
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(within(nav).getByText('프로필', { selector: '.menav-summary span' })).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(panel.classList.contains('open')).toBe(false)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(panel.classList.contains('open')).toBe(true)
    expect(within(panel).getByText('reader@storyfork.demo')).toBeTruthy()
    expect(within(panel).getAllByRole('link').map((link) => link.textContent)).toEqual(['프로필', '관심 소설', '저장 공간', '결제 내역', '문의하기', '공지사항', '이벤트'])
    expect(within(panel).getByRole('link', { name: '프로필' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(within(panel).getByRole('link', { name: '공지사항' }))
    await screen.findByRole('heading', { name: '공지사항' })
    nav = screen.getByRole('navigation', { name: '계정 메뉴' })
    toggle = within(nav).getByRole('button', { name: '계정 메뉴 열기' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(within(nav).getByText('공지사항', { selector: '.menav-summary span' })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: '공지사항' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(toggle)
    fireEvent.click(within(nav).getByRole('button', { name: '계정 메뉴 닫기' }))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(where()).toBe('/me/notice')
  })

  it('접힌 계정 메뉴에서도 로그인 전 정보와 기존 경로를 다시 펼칠 수 있다', async () => {
    renderAt('/me/notice', null)
    await screen.findByRole('heading', { name: '공지사항' })
    const nav = within(screen.getByRole('navigation', { name: '계정 메뉴' }))
    fireEvent.click(nav.getByRole('button', { name: '계정 메뉴 열기' }))
    expect(nav.getByText('로그인 전')).toBeTruthy()
    expect(nav.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/login', '/me/signup', '/me/inquiry', '/me/notice', '/me/event'])
    fireEvent.click(nav.getByRole('link', { name: '로그인' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeTruthy()
    expect(where()).toBe('/login')
  })

  it('프로필은 닉네임 2자·이메일 형식을 확인하고 저장한다', async () => {
    const { store } = renderAt('/me/profile')
    await screen.findByRole('heading', { name: '프로필' })
    expect(store.getState().ui.screen.base).toBe('U30')
    expect(document.getElementById('sid')).toBeNull()
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
    await toastIs('확인 메일을 보냈어요')
    within(screen.getByRole('navigation', { name: '계정 메뉴' })).getByText('reader@storyfork.demo')
    expect(within(screen.getByRole('navigation', { name: '계정 메뉴' })).queryByRole('button', { name: '로그아웃' })).toBeNull()
  })

  it('회원탈퇴는 30일 유예를 안내하고 실제로 바꾸지 않는다', async () => {
    const { store } = renderAt('/me/profile')
    fireEvent.click(await screen.findByRole('button', { name: '회원탈퇴' }))
    const sheet = await screen.findByRole('dialog', { name: '회원탈퇴' })
    within(sheet).getByText(/탈퇴 기능은 준비 중이며, 여기서는 실제 계정을 삭제할 수 없어요/)
    within(sheet).getByText(/정책 기획안.*30일/)
    expect(within(sheet).queryByRole('button', { name: '탈퇴하기' })).toBeNull()
    expect(within(sheet).queryByRole('checkbox')).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: '확인' }))
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
    const { store } = renderAt('/me/inquiry')
    await screen.findByRole('heading', { name: '문의하기' })
    expect(store.getState().ui.screen.base).toBe('U34')
    fireEvent.click(screen.getByRole('button', { name: '문의 보내기' }))
    await toastIs('제목과 내용을 입력해 주세요')
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '포크 질문' } })
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '어떻게 하나요?' } })
    fireEvent.click(screen.getByRole('button', { name: '문의 보내기' }))
    await toastIs('문의를 보냈어요 (데모 · 실제 전송 없음)')
    const q = await screen.findByText('[이용 문의] 포크 질문')
    within(q.closest('.rp') as HTMLElement).getByText('답변 대기')
  })

  it('로그인 전에는 보호 메뉴가 로그인으로 가고, 가입 화면은 미정 약관을 안내한다', async () => {
    renderAt('/me/profile', null)
    await waitFor(() => expect(where()).toBe('/login'))
    cleanup()
    renderAt('/me/signup', null)
    await screen.findByRole('heading', { name: '회원가입' })
    expect(document.getElementById('sid')).toBeNull()
    expect(screen.getByText(/운영 약관과 동의 절차는 준비 중/)).toBeTruthy()
    expect(screen.queryByLabelText('전체 동의')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '가입 요청' }))
    expect(screen.getByText('이메일 형식을 확인해 주세요')).toBeTruthy()
  })

  it('공지와 이벤트를 상세까지 연다', async () => {
    await appContainer.resolve('noticeUseCase').save(null, { title: '포크 이용 안내', body: '작가가 허용한 회차에서만\n포크할 수 있어요.' })
    renderAt('/me/notice', null)
    fireEvent.click(await screen.findByRole('link', { name: /포크 이용 안내/ }))
    await screen.findByRole('heading', { name: '포크 이용 안내' })
    expect(screen.getByText(/포크할 수 있어요/).textContent).toBe('작가가 허용한 회차에서만\n포크할 수 있어요.')
    cleanup()
    // 운영 이벤트 공개 API의 대역(메모리 저장소)에 이벤트를 등록해 두고 비로그인으로 목록→상세를 연다.
    const events = appContainer.resolve('eventRepository')
    const saved = await events.create({ title: '가을 맞이 이벤트', body: '첫 줄\n둘째 줄', startsAt: '2026-11-01T00:00:00.000Z', endsAt: null })
    try {
      const { store } = renderAt('/me/event', null)
      await waitFor(() => expect(store.getState().ui.screen.base).toBe('U35E'))
      await screen.findByText('보상·경품은 정해지지 않았어요. 이벤트는 기능 체험 안내예요.')
      fireEvent.click(await screen.findByRole('link', { name: /가을 맞이 이벤트/ }))
      await screen.findByRole('heading', { name: '가을 맞이 이벤트' })
      expect(where()).toBe(`/me/event?id=${saved.id}`)
      screen.getByText('진행 중')
      expect(screen.getByText(/첫 줄/).textContent).toBe('첫 줄\n둘째 줄')
      expect(screen.queryByRole('link', { name: /서비스 둘러보기/ })).toBeNull()
    } finally { await events.remove(saved.id) }
  })

  it('이벤트가 없으면 빈 안내를, 불러오기에 실패하면 실패를 알리고 다시 불러오기로 복구한다', async () => {
    const events = appContainer.resolve('eventUseCase')
    renderAt('/me/event', null)
    await screen.findByText('등록된 이벤트가 없어요.')
    cleanup()
    const list = vi.spyOn(events, 'listPublic').mockRejectedValueOnce(new Error('boom'))
    renderAt('/me/event', null)
    await screen.findByRole('alert')
    expect(screen.queryByText('등록된 이벤트가 없어요.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByText('등록된 이벤트가 없어요.')
    expect(list).toHaveBeenCalledTimes(2)
    list.mockRestore()
  })

  it('없는 이벤트 UUID와 옛 데모 링크(?id=0)는 찾을 수 없다고 안내한다', async () => {
    renderAt('/me/event?id=0', null)
    await screen.findByText('이벤트를 찾을 수 없어요.')
    cleanup()
    renderAt('/me/event?id=0b6f3e5a-2c9d-4c0e-9a55-1f6f6d1f7a01', null)
    await screen.findByText('이벤트를 찾을 수 없어요.')
    expect(screen.getByRole('link', { name: '목록으로' }).getAttribute('href')).toBe('/me/event')
  })

  it('공지 목록은 로그인 전에도 최신순으로 보이고 없는 공지는 찾을 수 없다고 알린다', async () => {
    const notices = appContainer.resolve('noticeUseCase')
    const older = await notices.save(null, { title: '먼저 올린 공지', body: '본문' })
    await new Promise((done) => setTimeout(done, 2))
    await notices.save(null, { title: '나중에 올린 공지', body: '본문' })
    renderAt('/me/notice', null)
    await screen.findByRole('link', { name: /나중에 올린 공지/ })
    const titles = [...document.querySelectorAll('.ntc b')].map((x) => x.textContent)
    expect(titles.indexOf('나중에 올린 공지')).toBeLessThan(titles.indexOf('먼저 올린 공지'))
    expect(screen.getByRole('link', { name: /먼저 올린 공지/ }).getAttribute('href')).toBe(`/me/notice?id=${older.id}`)
    cleanup()
    renderAt('/me/notice?id=missing', null)
    await screen.findByText('공지사항을 찾을 수 없어요.')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('공지 조회 실패는 빈 목록·없음으로 숨기지 않고 오류와 다시 불러오기를 보인다', async () => {
    const notices = appContainer.resolve('noticeUseCase')
    await notices.save(null, { title: '복구 뒤 보일 공지', body: '본문' })
    const list = vi.spyOn(notices, 'listPublic').mockRejectedValueOnce(new Error('서버 오류'))
    renderAt('/me/notice', null)
    expect((await screen.findByRole('alert')).textContent).toBe('공지사항을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(screen.queryByText('등록된 공지사항이 없어요.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByRole('link', { name: /복구 뒤 보일 공지/ })
    expect(list).toHaveBeenCalledTimes(2)
    cleanup()
    vi.spyOn(notices, 'getPublic').mockRejectedValueOnce(new Error('서버 오류'))
    renderAt('/me/notice?id=any', null)
    await screen.findByRole('alert')
    expect(screen.queryByText('공지사항을 찾을 수 없어요.')).toBeNull()
  })

  it('관심 소설은 처음 누른 순서대로 보인다 (목업 Object.keys(S.liked))', async () => {
    const reading = appContainer.resolve('readingUseCase')
    await reading.toggleLike('postman'); await reading.toggleLike('guunmong')
    renderAt('/me/liked')
    await screen.findByText('2편')
    expect([...document.querySelectorAll('.grid6 .hk')].map((x) => x.textContent)).toEqual(['회색 도시의 우편배달부', '구운몽'].map((t) => expect.stringContaining(t.split(' ')[0])))
    await reading.toggleLike('postman'); await reading.toggleLike('guunmong')
  })

  it('불러오기 전에는 없음·0 상태를 먼저 그리지 않는다', () => {
    renderAt('/me/notice?id=1', null)
    expect(screen.queryByText('공지사항을 찾을 수 없어요.')).toBeNull()
    cleanup()
    renderAt('/me/event?id=0', null)
    expect(screen.queryByText('이벤트를 찾을 수 없어요.')).toBeNull()
    cleanup()
    renderAt('/me/liked')
    expect(screen.queryByText('0편')).toBeNull()
    cleanup()
    renderAt('/me/inquiry')
    expect(screen.queryByText('아직 보낸 문의가 없어요.')).toBeNull()
    expect(screen.queryByText('내 문의 0')).toBeNull()
  })

  it('문의를 보내면 유형도 이용 문의로 돌아간다 (목업 #iqf render())', async () => {
    renderAt('/me/inquiry')
    await screen.findByRole('heading', { name: '문의하기' })
    const t = screen.getByLabelText<HTMLSelectElement>('문의 유형')
    fireEvent.change(t, { target: { value: '계정' } })
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '계정 질문' } })
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '내용' } })
    fireEvent.click(screen.getByRole('button', { name: '문의 보내기' }))
    await screen.findByText('[계정] 계정 질문')
    expect(screen.getByLabelText<HTMLSelectElement>('문의 유형').value).toBe('이용 문의')
  })

  it('프로필 저장 뒤 입력칸에 앞뒤 공백을 뺀 값을 보여 준다 (목업 saveProfile)', async () => {
    renderAt('/me/profile')
    const nick = await screen.findByLabelText<HTMLInputElement>('닉네임'), email = screen.getByLabelText<HTMLInputElement>('이메일')
    fireEvent.change(nick, { target: { value: '  새이름  ' } })
    fireEvent.change(email, { target: { value: ' a@b.co ' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await toastIs('확인 메일을 보냈어요')
    expect(screen.getByLabelText<HTMLInputElement>('닉네임').value).toBe('새이름')
    expect(screen.getByLabelText<HTMLInputElement>('이메일').value).toBe('a@b.co')
  })

  it('비로그인 계정 메뉴의 로그인 항목은 목업 id menuLogin을 쓴다', () => {
    renderAt('/', null)
    fireEvent.click(screen.getByRole('button', { name: '로그인·회원가입 메뉴' }))
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: '로그인' }).id).toBe('menuLogin')
  })
})

// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import '../../../../test/testLocks'

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { OperationsError } from '../../../../domain/entities/operations'
import type { SupportInquiry } from '../../../../domain/entities/supportInquiry'
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
    // 필수는 속성뿐 아니라 가입 폼과 같은 문구로도 보인다.
    within(form!).getByText('모든 항목은 필수예요.')
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
  const support = () => appContainer.resolve('supportInquiryUseCase')

  it('제목·내용은 필수이고 비어 있으면 필드 옆 경고와 첫 오류 필드 초점을 준다', async () => {
    setup('/me/inquiry')
    await screen.findByRole('heading', { name: '문의하기' })
    expect(field('제목').required).toBe(true)
    expect(field('내용').required).toBe(true)
    within(document.getElementById('iqf')!).getByText('모든 항목은 필수예요.')
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
    let finish!: () => void
    const create = vi.spyOn(support(), 'create').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
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
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({ category: '이용 문의', title: '포크 질문', body: '어떻게 하나요?' })
    await act(async () => { finish() })
    await waitFor(() => expect(screen.getAllByText('문의를 보냈어요').some((el) => el.getAttribute('role') === 'status')).toBe(true))
    expect(screen.queryByText(/데모 · 실제 전송 없음/)).toBeNull()
    expect(field('제목').value).toBe('')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '문의 보내기' }).disabled).toBe(false)
  })

  it('전송이 거절되면 입력을 그대로 두고 서버가 알려 준 이유를 경고로 보여 준다', async () => {
    vi.spyOn(support(), 'create').mockRejectedValueOnce(new OperationsError('이 작업을 할 권한이 없어요.'))
    setup('/me/inquiry')
    await screen.findByRole('heading', { name: '문의하기' })
    fireEvent.change(field('제목'), { target: { value: '실패 질문' } })
    fireEvent.change(field('내용'), { target: { value: '남아야 하는 내용' } })
    fireEvent.click(screen.getByRole('button', { name: '문의 보내기' }))
    expect((await screen.findByRole('alert')).textContent).toBe('이 작업을 할 권한이 없어요.')
    expect(field('제목').value).toBe('실패 질문')
    expect(field('내용').value).toBe('남아야 하는 내용')
    expect(screen.queryByText('문의를 보냈어요')).toBeNull()
  })

  it('응답을 받지 못한 실패는 접수 여부를 확인하도록 안내하고 내부 오류를 노출하지 않는다', async () => {
    vi.spyOn(support(), 'create').mockRejectedValueOnce(new TypeError('Failed to fetch: 내부 주소'))
    setup('/me/inquiry')
    await screen.findByRole('heading', { name: '문의하기' })
    fireEvent.change(field('제목'), { target: { value: '네트워크 질문' } })
    fireEvent.change(field('내용'), { target: { value: '내용' } })
    fireEvent.click(screen.getByRole('button', { name: '문의 보내기' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('문의를 보냈는지 확인하지 못했어요')
    expect(alert.textContent).not.toContain('내부 주소')
    expect(field('제목').value).toBe('네트워크 질문')
  })

  it('로그인 전에는 폼 대신 로그인 안내를 보이고, 로그인 뒤 문의하기로 돌아오도록 안내를 남긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 })))
    const { store } = renderApp('/me/inquiry', createAppStore({ role: null }))
    await screen.findByRole('heading', { name: '로그인한 뒤 문의할 수 있어요' })
    expect(screen.queryByLabelText('제목')).toBeNull()
    expect(screen.queryByRole('button', { name: '문의 보내기' })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '로그인하고 문의하기' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeTruthy()
    expect(store.getState().session).toMatchObject({ next: '/me/inquiry', loginRole: 'user', loginMsg: '문의는 로그인한 회원만 보낼 수 있어요.' })
  })
})

describe('내 문의 목록 (U34)', () => {
  const support = () => appContainer.resolve('supportInquiryUseCase')
  const at = '2026-11-08T00:00:00Z'
  const row = (patch: Partial<SupportInquiry>): SupportInquiry => ({ id: 'q', memberId: 'm', category: '계정', title: '제목', body: '본문', status: 'WAITING', createdAt: at, updatedAt: at, replies: [], ...patch })

  it('불러오는 중·실패·빈 목록을 구분하고 실패하면 다시 불러올 수 있다', async () => {
    vi.spyOn(support(), 'listMine').mockRejectedValueOnce(new OperationsError('실패')).mockResolvedValueOnce([])
    setup('/me/inquiry')
    await screen.findByText('내 문의를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(screen.queryByText('아직 보낸 문의가 없어요.')).toBeNull()
    expect(screen.queryByText('내 문의 0')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByText('아직 보낸 문의가 없어요.')
    expect(screen.queryByText(/불러오지 못했어요/)).toBeNull()
  })

  it('상태 칩과 답변 여러 개를 등록 순서대로, 줄바꿈을 유지해 보여 준다', async () => {
    const reply = (id: string, body: string) => ({ id, body, createdAt: at, updatedAt: at })
    vi.spyOn(support(), 'listMine').mockResolvedValue([
      row({ id: 'a', title: '답변된 문의', body: '첫 줄\n둘째 줄', status: 'ANSWERED', replies: [reply('p1', '첫 답변\n줄2'), reply('p2', '둘째 답변')] }),
      row({ id: 'b', title: '기다리는 문의' }),
    ])
    setup('/me/inquiry')
    const answered = (await screen.findByText('[계정] 답변된 문의')).closest('.rp') as HTMLElement
    within(answered).getByText('답변 완료')
    expect([...answered.querySelectorAll('.inquiry-reply')].map((p) => p.textContent)).toEqual(['운영팀 답변 1첫 답변\n줄2', '운영팀 답변 2둘째 답변'])
    expect(within(answered).getByText('첫 줄 둘째 줄').textContent).toBe('첫 줄\n둘째 줄')
    const waiting = screen.getByText('[계정] 기다리는 문의').closest('.rp') as HTMLElement
    within(waiting).getByText('답변 대기')
    expect(waiting.querySelector('.inquiry-reply')).toBeNull()
    screen.getByRole('heading', { name: '내 문의 2' })
  })
})

describe('관심 소설·저장 공간 조회 상태 (U32)', () => {
  const account = () => appContainer.resolve('accountUseCase')

  it('관심 소설을 불러오는 동안에는 빈 화면 대신 불러오는 중임을 알린다', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(account(), 'liked').mockImplementation(async () => { await gate; return [] })
    setup('/me/liked')
    const loading = await screen.findByText('관심 소설을 불러오고 있어요.')
    expect(loading.getAttribute('role')).toBe('status')
    screen.getByRole('heading', { name: '관심 소설', level: 2 })
    expect(screen.queryByText('0편')).toBeNull()
    await act(async () => { release() })
    await screen.findByText('소설 상세에서 ♡를 누르면 여기에 모여요.')
    expect(screen.queryByText('관심 소설을 불러오고 있어요.')).toBeNull()
  })

  /** 조회 실패 안내와 제목을 확인한 뒤, `restore`로 조회를 되살리고 다시 불러와 `loaded`가 보이는지 본다. */
  async function failsThenRecovers(path: string, title: string, restore: () => void, loaded: string | RegExp) {
    setup(path)
    const alert = await screen.findByText(`${title}을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.`)
    expect(alert.getAttribute('role')).toBe('alert')
    screen.getByRole('heading', { name: title, level: 2 })
    restore()
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByText(loaded)
    expect(screen.queryByText(/불러오지 못했어요/)).toBeNull()
  }

  // 세션 복원이 같은 범위를 한 번 더 읽으므로 계속 실패시키고, 다시 불러오기 직전에 원래 조회로 되돌린다.
  it('관심 소설 조회에 실패하면 빈 화면으로 숨기지 않고 알린 뒤 다시 불러올 수 있다', async () => {
    const liked = vi.spyOn(account(), 'liked').mockRejectedValue(new Error('down'))
    await failsThenRecovers('/me/liked', '관심 소설', () => liked.mockRestore(), '소설 상세에서 ♡를 누르면 여기에 모여요.')
  })

  it('저장 공간 조회에 실패하면 빈 화면으로 숨기지 않고 알린 뒤 다시 불러올 수 있다', async () => {
    const storage = vi.spyOn(account(), 'storage').mockRejectedValue(new Error('down'))
    await failsThenRecovers('/me/storage', '저장 공간', () => storage.mockRestore(), /저장 공간 관리는 MVP에서 제외됐어요/)
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

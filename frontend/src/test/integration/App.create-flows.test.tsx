// @vitest-environment jsdom
import '../fixtureApp'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../scrollToSpy'
import App from '../../App'
import { appContainer } from '../../app/appContainer'
import { createAppStore } from '../../app/store'

vi.mock('../../presentation/features/studio/view/StudioPage', () => ({ StudioPage: () => <h1>집필실</h1> }))

beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

let nav: NavigateFunction
const Where = () => { const l = useLocation(); nav = useNavigate(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const renderAt = (path: string, store = createAppStore({ role: 'user' })) => { render(<Provider store={store}><MemoryRouter initialEntries={[path]} useTransitions={false}><App /><Where /></MemoryRouter></Provider>); return store }
const acceptPolicy = async () => {
  fireEvent.click(await screen.findByLabelText(/운영 정책을 확인했고/))
  fireEvent.click(screen.getByRole('button', { name: '정책 확인 후 작품 설정하기' }))
  await screen.findByRole('heading', { name: '새 소설 쓰기' })
}
const day = (d: string) => screen.getByLabelText<HTMLInputElement>(d)
const checked = () => ['월요일', '화요일', '비정기'].filter((d) => day(d).checked)

describe('목업 새 소설 만들기 (U28)', () => {
  beforeEach(() => { vi.stubEnv('MODE', 'mockup') })

  it('비정기와 요일 선택은 서로 배타적이다', async () => {
    renderAt('/new')
    await acceptPolicy()
    expect(checked()).toEqual(['비정기'])
    fireEvent.click(day('월요일'))
    fireEvent.click(day('화요일'))
    expect(checked()).toEqual(['월요일', '화요일'])
    fireEvent.click(day('비정기'))
    expect(checked()).toEqual(['비정기'])
  })

  it('태그를 지우면 포커스가 입력창으로 간다', async () => {
    renderAt('/new')
    await acceptPolicy()
    const input = screen.getByLabelText('직접 입력')
    fireEvent.change(input, { target: { value: '등대' } })
    fireEvent.click(screen.getByRole('button', { name: '직접 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '등대 태그 삭제' }))
    expect(document.activeElement).toBe(input)
  })

  it('규칙 공개를 체크해도 편집 중인 세계관 입력이 남는다', async () => {
    await appContainer.resolve('worldRepository').save({ id: 'w-keep', name: '남는 세계', description: '', rules: ['규칙 하나'], public: false })
    renderAt('/new')
    await acceptPolicy()
    const form = document.querySelector<HTMLFormElement>('[data-world-edit="w-keep"]')!
    const name = form.querySelector<HTMLInputElement>('[name=name]')!
    fireEvent.change(name, { target: { value: '고치는 중' } })
    fireEvent.click(screen.getAllByLabelText('규칙 하나').find((x) => !x.closest('#combineWorlds'))!)
    await waitFor(() => expect(document.getElementById('toast')!.textContent).toBe('세계관의 항목 공개 범위를 변경했어요 (데모)'))
    expect(document.querySelector<HTMLInputElement>('[data-world-edit="w-keep"] [name=name]')!.value).toBe('고치는 중')
  })

  it('다른 화면에 갔다 와도 작성 내용이 남고, 만든 뒤에는 세계관 선택과 표지만 비운다', async () => {
    await appContainer.resolve('worldRepository').save({ id: 'w-new', name: '작성 세계', description: '', rules: [], public: false })
    renderAt('/new')
    await acceptPolicy()
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '남는 제목' } })
    act(() => { nav('/status') })
    await screen.findByRole('heading', { name: '서비스 연결 상태' })
    act(() => { nav('/new') })
    await acceptPolicy()
    expect(screen.getByLabelText<HTMLInputElement>('제목').value).toBe('남는 제목')
    fireEvent.click(await screen.findByLabelText(/작성 세계 · 내 비공개 세계관/))
    for (const t of ['하나', '둘']) {
      fireEvent.change(screen.getByLabelText('직접 입력'), { target: { value: t } })
      fireEvent.click(screen.getByRole('button', { name: '직접 추가' }))
    }
    fireEvent.change(screen.getByLabelText('인물 1 이름'), { target: { value: '등대지기' } })
    fireEvent.click(screen.getByRole('button', { name: '소설 만들고 1화 쓰기 →' }))
    await screen.findByRole('heading', { name: '집필실' })
    expect(where()).toMatch(/^\/studio\//)
    act(() => { nav('/new') })
    await acceptPolicy()
    expect(screen.getByLabelText<HTMLInputElement>('제목').value).toBe('남는 제목')
    screen.getByRole('button', { name: '하나 태그 삭제' })
    expect(screen.getByLabelText<HTMLInputElement>(/작성 세계 · 내 비공개 세계관/).checked).toBe(false)
  })
})

describe('캐릭터 챗·로그인 보호·포크 대상', () => {
  it('/chat/없는작품은 주소를 유지한 채 목록을 보여 준다', async () => {
    renderAt('/chat/nope')
    await screen.findByRole('heading', { name: '캐릭터챗' })
    expect(where()).toBe('/chat/nope')
  })

  it('비로그인 /write는 로그인 안내를 보여 주고, 로그인하면 /write로 돌아온다', async () => {
    vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: object, callback: (lock: object) => Promise<unknown>) => callback({}) } })
    const fetch = vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'csrf' })
      : path.endsWith('/refresh') ? new Response(null, { status: 401 })
        : Response.json({ accessToken: 'token', user: { id: 'reader', email: 'reader@example.invalid', nickname: '독자', operator: false } }))
    vi.stubGlobal('fetch', fetch)
    const store = renderAt('/write', createAppStore())
    await screen.findByText('로그인이 필요한 화면이에요.')
    expect(store.getState().session.next).toBe('/write')
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'reader@example.invalid' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'test-password' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(where()).toBe('/lib?tab=write'))
    expect(store.getState().session.role).toBe('user')
    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/login', expect.objectContaining({ body: JSON.stringify({ email: 'reader@example.invalid', password: 'test-password' }) }))
  })

  it('정책 화면을 떠났다가 뒤로 돌아와 제출하면 포크 대상이 비어 원작 랭킹으로 간다', async () => {
    renderAt('/')
    act(() => { nav('/writing-policy?method=fork', { state: { target: '/fork/guunmong' } }) })
    await screen.findByRole('heading', { name: '다른 소설 포크 전 확인' })
    act(() => { nav('/') })
    act(() => { nav(-1) })
    fireEvent.click(await screen.findByLabelText('이 집필 방식의 정책과 안내를 확인했습니다.'))
    fireEvent.click(screen.getByLabelText('저작권과 이용 권한 안내를 확인했고, 필요한 권리를 보유했거나 허락받았습니다.'))
    fireEvent.click(screen.getByRole('button', { name: '동의하고 계속' }))
    await waitFor(() => expect(where()).toBe('/rank?t=orig'))
  })
})

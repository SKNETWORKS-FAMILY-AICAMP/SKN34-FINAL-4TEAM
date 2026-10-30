// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { appContainer } from './app/appContainer'
import { createAppStore } from './app/store'

beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.useRealTimers() })

let nav: NavigateFunction
const Where = () => { const l = useLocation(); nav = useNavigate(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const toastIs = (t: string) => waitFor(() => expect(document.getElementById('toast')!.textContent).toBe(t))
const renderAt = (path: string, store = createAppStore({ role: 'user' })) => render(<Provider store={store}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></Provider>)
const sentence = async (t: string) => (await screen.findAllByText(t)).find((el) => el.classList.contains('s'))!

describe('빠른 이동 (U03) · 집필실', () => {
  it('집필실에서 열면 탭 이동 항목이 먼저 나오고 현재 회차를 유지한다', async () => {
    renderAt('/studio/starlight?ep=1')
    await waitFor(() => expect(where()).toBe('/studio/starlight?ep=1'))
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const dialog = screen.getByRole('dialog', { name: '빠른 이동' })
    await waitFor(() => expect([...dialog.querySelectorAll('#ql li b')].slice(0, 3).map((x) => x.textContent)).toEqual(['AI 채팅', '플롯', '집필 설정']))
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '사전에서' } })
    screen.getByText('카엘')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '' } })
    fireEvent.click(within(dialog).getByText('플롯'))
    await waitFor(() => expect(where()).toBe('/studio/starlight?view=narrative&ep=1'))
  })

  it('크레딧 정책 시트를 연 채 Ctrl K를 누르면 시트가 교체되고 Esc 한 번에 닫힌다', async () => {
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: /✦ 크레딧/ }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.getAllByRole('dialog').map((d) => d.getAttribute('aria-label'))).toEqual(['빠른 이동']))
    expect(document.getElementById('sid')!.textContent).toContain('U03')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('남의 작품 집필실에서는 탭 이동·설정 노트 인물 후보를 넣지 않는다', async () => {
    renderAt('/studio/guunmong')
    await waitFor(() => expect(where()).toMatch(/^\/studio\/guunmong/))
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const dialog = screen.getByRole('dialog', { name: '빠른 이동' })
    await waitFor(() => expect(dialog.querySelectorAll('#ql li b').length).toBeGreaterThan(0))
    expect(within(dialog).queryByText('AI 도움 탭')).toBeNull()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '사전에서' } })
    expect(within(dialog).queryAllByText('사전에서 보기')).toHaveLength(0)
  })
})

describe('가져오기 (U24) · 편집과 진행 상태', () => {
  const ready = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /예시 소설 선택/ }))
    const sel = screen.getByLabelText<HTMLSelectElement>('연결할 내 세계관')
    await waitFor(() => expect(sel.options.length).toBeGreaterThan(1))
    fireEvent.change(sel, { target: { value: sel.options[1].value } })
    fireEvent.click(screen.getByLabelText('이 소설을 AI로 처리할 권리가 있어요'))
  }

  it('진행 중 다른 화면에 다녀와도 선택값과 진행 상태가 유지되고, 고친 항목이 JSON과 저장에 반영된다', async () => {
    await appContainer.resolve('worldRepository').save({ id: 'w-flow', name: '흐름 세계', description: '', rules: [], public: false })
    renderAt('/import')
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '정리 시작' }))
    await screen.findByRole('button', { name: '정리 중…' })
    act(() => { nav('/new') })
    await waitFor(() => expect(where()).toBe('/new'))
    expect(screen.queryByRole('heading', { name: '내 소설 가져오기' })).toBeNull()
    act(() => { nav('/import') })
    screen.getByText('✓ 춘향전_전문.txt · 286KB')
    expect(screen.getByLabelText<HTMLInputElement>('이 소설을 AI로 처리할 권리가 있어요').checked).toBe(true)
    const li = await screen.findByText('방자 · 몽룡의 몸종', {}, { timeout: 4000 })
    li.textContent = '방자 · 꾀 많은 몸종 '
    fireEvent.blur(li)
    expect(document.getElementById('json')!.textContent).toContain('"role": "꾀 많은 몸종"')
    fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }))
    await toastIs('세계관·인물·사건을 저장했어요 (비공개 상태)')
    const w = (await appContainer.resolve('workRepository').listWorks()).find((x) => x.id === 'chunhyang')!
    expect(w.cast.find((c) => c.n === '방자')!.d).toBe('꾀 많은 몸종')
  })
})

describe('화면 상태 초기화', () => {
  it('다음 화로 이동하면 문장 팝업이 닫힌다', async () => {
    renderAt('/read/postman/1')
    fireEvent.click(await sentence('“이건 어디로 가야 하지.”'))
    screen.getByRole('button', { name: '💬 댓글 달기' })
    fireEvent.click(screen.getByRole('button', { name: '다음 화 ›' }))
    await screen.findByRole('heading', { name: '7구역의 소녀' })
    expect(screen.queryByRole('button', { name: '💬 댓글 달기' })).toBeNull()
    expect(document.querySelector('.s.sel')).toBeNull()
  })

  it('다른 작품으로 가면 회차 검색어가 비워진다', async () => {
    renderAt('/work/guunmong')
    await screen.findByRole('heading', { name: '구운몽' })
    fireEvent.change(screen.getByLabelText('회차 검색'), { target: { value: '팔선녀' } })
    act(() => { nav('/work/postman') })
    await screen.findByRole('heading', { name: '회색 도시의 우편배달부' })
    expect(screen.getByLabelText<HTMLInputElement>('회차 검색').value).toBe('')
  })

  it('피드백함 항목을 바꾸면 답변 입력이 비워진다', async () => {
    const repo = appContainer.resolve('feedbackRepository')
    const item = (id: string) => ({ id, rid: 'r-' + id, w: 'starlight', n: 1, pi: 0, type: '질문', who: '독자', text: '흐름 ' + id, baseText: '', status: '작가 검토 대기', ai: { cls: '제안', why: '안내', ev: '문장' } })
    await repo.addInbox(item('fa'))
    await repo.addInbox(item('fb'))
    renderAt('/inbox?i=fa')
    fireEvent.change(await screen.findByLabelText('작가 답변'), { target: { value: 'A에게 쓴 답' } })
    fireEvent.click(screen.getByText('흐름 fb'))
    await waitFor(() => expect(where()).toBe('/inbox?i=fb'))
    expect(screen.getByLabelText<HTMLTextAreaElement>('작가 답변').value).toBe('')
  })
})

describe('상세·홈·주소', () => {
  it('자율 연재가 켜진 작품은 장르 뒤에 칩을 보여 준다', async () => {
    const repo = appContainer.resolve('workRepository')
    const w = (await repo.listWorks()).find((x) => x.id === 'postman')!
    await repo.saveWork({ ...w, auto: { on: true, status: '', react: false, requireReview: true, log: [] } })
    renderAt('/work/postman')
    const chip = await screen.findByText('🤖 AI 자율 연재 중')
    expect(chip.className).toBe('chip ok')
    expect(chip.style.marginLeft).toBe('8px')
    expect(chip.previousElementSibling!.textContent).toBe('SF')
    await repo.saveWork(w)
  })

  it('/read/:id는 1화를 연다', async () => {
    renderAt('/read/postman')
    await screen.findByRole('heading', { name: '수취인 불명' })
  })

  it('캐러셀은 시트가 열려 있으면 멈추고, 다른 화면에 다녀와도 위치를 유지한다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAt('/')
    await screen.findByText(/^1 \/ \d+$/)
    fireEvent.click(screen.getByRole('button', { name: '다음 소설' }))
    expect(document.getElementById('cnt')!.textContent).toMatch(/^2 \//)
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    act(() => { vi.advanceTimersByTime(4600) })
    expect(document.getElementById('cnt')!.textContent).toMatch(/^2 \//)
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => { nav('/rank') })
    act(() => { nav('/') })
    await screen.findByText(/^2 \/ \d+$/)
  })
})

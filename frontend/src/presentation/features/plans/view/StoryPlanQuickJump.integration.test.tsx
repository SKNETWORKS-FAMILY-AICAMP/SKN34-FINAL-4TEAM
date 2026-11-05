// @vitest-environment jsdom
import { StrictMode, useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../../app/store'
import { createMockDb, InMemoryWorkRepository } from '../../../../data/mock/InMemoryRepositories'
import { InMemoryStoryPlanRepository } from '../../../../data/plans/InMemoryStoryPlanRepository'
import { StoryPlanUseCase } from '../../../../domain/usecases/StoryPlanUseCase'
import type { StoryPlan } from '../../../../domain/entities/storyPlan'
import { useStoryPlanViewModel } from '../viewmodel/useStoryPlanViewModel'
import { openQuick } from '../../../shared/events'
import { Sheet } from '../../../shared/Sheet'
import { QuickJump } from '../../../shared/shell/QuickJump'
import { StoryPlanWorkspace } from './StoryPlanWorkspace'

const path = '/studio/00000000-0000-0000-0000-000000000001?view=narrative'
const Where = () => { const location = useLocation(); return <output data-testid="where">{location.pathname + location.search}</output> }
function OtherSheet() {
  const [open, setOpen] = useState(true)
  return open ? <Sheet sid="U19" label="기존 시트" onClose={() => setOpen(false)}><button>닫기</button></Sheet> : null
}
const open = {
  Ctrl: () => fireEvent.keyDown(document, { key: 'k', ctrlKey: true }),
  Cmd: () => fireEvent.keyDown(document, { key: 'k', metaKey: true }),
  'sf-quick': () => act(() => { openQuick() }),
}
const choose = {
  click: (dialog: HTMLElement) => fireEvent.click(within(dialog).getByText('‘이동 회귀’ 검색 결과 모두 보기')),
  Enter: (dialog: HTMLElement) => fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Enter' }),
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })
async function setup() {
  const db = createMockDb()
  const work = db.works.find(w => w.id === 'starlight')!
  work.owner = 'me'
  const api = new StoryPlanUseCase(new InMemoryStoryPlanRepository(new InMemoryWorkRepository(db)))
  window.history.replaceState({ idx: 0 }, '', path)
  // Keep the workspace mounted when only the search parameters change, as on studio routes.
  const view = render(<StrictMode><Provider store={createAppStore({ role: 'user' })}><BrowserRouter useTransitions={false}>
    <Routes><Route path="/studio/:id" element={<StoryPlanWorkspace workId={work.id} demo api={api} />} /><Route path="/search" element={<h1>검색 도착</h1>} /></Routes>
    <QuickJump /><Where />
  </BrowserRouter></Provider></StrictMode>)
  await waitFor(() => expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', false))
  return { api, ...view }
}
function edit() {
  fireEvent.click(screen.getByRole('button', { name: '플롯 추가' }))
  const input = screen.getByLabelText('플롯 제목')
  fireEvent.change(input, { target: { value: '보존할 계획' } })
  return input
}
function search() {
  const dialog = screen.getByRole('dialog', { name: '빠른 이동' })
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '이동 회귀' } })
  return dialog
}
function stays() {
  expect(screen.getByTestId('where').textContent).toBe(path)
  expect(window.location.pathname + window.location.search).toBe(path)
}

describe('계획과 실제 QuickJump Sheet · CI 통합', () => {
  it.each(['Ctrl', 'Cmd', 'sf-quick'] as const)('%s에서 버리기를 거부하면 QuickJump를 열거나 계획 Sheet를 교체하지 않는다', async trigger => {
    await setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const input = edit()
    open[trigger]()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: '빠른 이동' })).toBeNull()
    expect(screen.getByLabelText('플롯 제목')).toBe(input)
    expect(input).toHaveProperty('value', '보존할 계획')
    // A rejected opening must not leave a hidden QuickJump that can navigate on Enter.
    fireEvent.keyDown(input, { key: 'Enter' })
    stays()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it.each(['Ctrl', 'Cmd', 'sf-quick'] as const)('%s를 연 뒤 늦은 계획 수정 조회가 완료되어도 QuickJump와 해제된 로딩을 유지한다', async trigger => {
    const { api } = await setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    edit()
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '플롯 수정' })).toHaveProperty('disabled', false))
    const [plan] = await api.list('starlight')
    let finish!: (plan: StoryPlan) => void
    // Ignore abort in the fake: even a late successful response must not open the editor.
    const read = vi.spyOn(api, 'read').mockImplementation(() => new Promise<StoryPlan>(resolve => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '플롯 수정' }))
    expect(read).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', true)
    open[trigger]()
    const dialog = screen.getByRole('dialog', { name: '빠른 이동' })
    expect(read.mock.calls[0][2]?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', false)
    await act(async () => { finish(plan) })
    expect(screen.getByRole('dialog', { name: '빠른 이동' })).toBe(dialog)
    expect(screen.queryByLabelText('플롯 제목')).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', false)
    expect(confirm).not.toHaveBeenCalled()
    stays()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '플롯 추가' }))
    expect(screen.getByLabelText('플롯 제목')).toBeTruthy()
  })

  it.each(['click', 'Enter'] as const)('취소 후 승인하면 %s로 한 번만 이동한다', async selection => {
    await setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const push = vi.spyOn(window.history, 'pushState')
    edit()
    open.Ctrl()
    stays()
    confirm.mockReturnValue(true)
    open['sf-quick']()
    expect(screen.queryByLabelText('플롯 제목')).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    choose[selection](search())
    await screen.findByRole('heading', { name: '검색 도착' })
    expect(window.location.pathname + window.location.search).toBe('/search?q=%EC%9D%B4%EB%8F%99%20%ED%9A%8C%EA%B7%80')
    expect(push).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it.each(['Ctrl', 'Cmd', 'sf-quick'] as const)('%s는 저장 요청 중 계획 Sheet를 덮거나 이동 후보를 열지 않는다', async trigger => {
    const { api } = await setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let finish!: () => void
    vi.spyOn(api, 'save').mockImplementation(async (_workId, value) => {
      await new Promise<void>(resolve => { finish = resolve })
      return { ...value, id: 'saved', workId: 'starlight', revision: 1, episodeMissing: false }
    })
    const input = edit()
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    open[trigger]()
    expect(screen.queryByRole('dialog', { name: '빠른 이동' })).toBeNull()
    expect(screen.getByLabelText('플롯 제목')).toBe(input)
    expect(input).toHaveProperty('value', '보존할 계획')
    stays()
    expect(confirm).not.toHaveBeenCalled()
    await act(async () => { finish() })
    open[trigger]()
    expect(screen.getByRole('dialog', { name: '빠른 이동' })).toBeTruthy()
  })

  it.each(['click', 'Enter'] as const)('이미 열린 QuickJump의 %s도 선택 시점의 진행 중 변경을 확인한다', async selection => {
    const db = createMockDb()
    const work = db.works.find(w => w.id === 'starlight')!
    work.owner = 'me'
    const api = new StoryPlanUseCase(new InMemoryStoryPlanRepository(new InMemoryWorkRepository(db)))
    const plan: StoryPlan = { kind: 'plot', parentId: null, title: '삭제할 계획', content: '', episodeNumber: null, characterIds: [], placeIds: [], id: 'plan', workId: work.id, revision: 1, episodeMissing: false }
    let finish!: () => void
    vi.spyOn(api, 'remove').mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    window.history.replaceState({ idx: 0 }, '', path)
    const store = createAppStore({ role: 'user' })
    const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><BrowserRouter useTransitions={false}>{children}<QuickJump /><Where /></BrowserRouter></Provider>
    const { result } = renderHook(() => useStoryPlanViewModel(work.id, true, api), { wrapper })
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => { result.current.askDelete(plan) })
    open.Ctrl()
    const dialog = search()
    // Simulate work starting after the palette is mounted, not just a blocked opening.
    act(() => { result.current.remove() })
    choose[selection](dialog)
    stays()
    expect(screen.getByRole('dialog', { name: '빠른 이동' })).toBe(dialog)
    await act(async () => { finish() })
    choose[selection](dialog)
    await waitFor(() => expect(window.location.pathname).toBe('/search'))
  })

  it.each(['click', 'Enter'] as const)('깨끗한 편집기는 Sheet 교체 후 %s로 정상 이동한다', async selection => {
    await setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '플롯 추가' }))
    open.Cmd()
    expect(screen.queryByLabelText('플롯 제목')).toBeNull()
    choose[selection](search())
    await screen.findByRole('heading', { name: '검색 도착' })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('계획 가드 정리 후 다른 Sheet의 기존 교체·닫기는 그대로 동작한다', async () => {
    const { unmount } = await setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    edit()
    unmount()
    render(<Provider store={createAppStore()}><BrowserRouter useTransitions={false}>
      <OtherSheet /><QuickJump />
    </BrowserRouter></Provider>)
    open.Ctrl()
    expect(screen.queryByRole('dialog', { name: '기존 시트' })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

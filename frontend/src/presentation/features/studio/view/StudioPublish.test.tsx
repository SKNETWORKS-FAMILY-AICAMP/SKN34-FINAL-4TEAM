// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { createMockDb } from '../../../../data/mock/InMemoryRepositories'
import { useStudioViewModel } from '../viewmodel/useStudioViewModel'
import { StudioPage } from './StudioPage'

// This file uses its own container; production and other tests keep their repositories.
vi.mock('../../../../app/appContainer', async () => {
  const { createAppContainer } = await import('../../../../app/di/container')
  return { appContainer: createAppContainer() }
})

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const work = () => appContainer.resolve('mockDb').works.find(w => w.id === 'starlight')!
const api = () => appContainer.resolve('studioUseCase')
function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={['/studio/starlight']}>{children}</MemoryRouter></Provider>
}
async function hook(ep?: number) {
  const result = renderHook(() => useStudioViewModel('starlight', ep, 'ai', api(), appContainer.resolve('libraryUseCase')), { wrapper })
  await waitFor(() => expect(result.result.current.draft).toBeTruthy())
  return result
}
beforeEach(() => {
  Object.assign(appContainer.resolve('mockDb'), createMockDb())
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('keeps cover and plot saves and AI prompt input quiet while preserving their data', async () => {
  const { result } = await hook()
  const key = result.current.studio!.key
  await act(async () => {
    await result.current.saveNotes({ coverImg: 'demo-cover' })
    expect(work().coverImg).toBe('demo-cover')
    await result.current.saveNotes({ coverImg: null, narrativeOrder: ['첫 사건'] })
  })
  expect(work()).toMatchObject({ coverImg: null, narrativeOrder: ['첫 사건'] })
  expect(result.current.saving).toBe(false)
  act(() => result.current.setPrompt('다음 장면을 이어 써 주세요'))
  expect(result.current.saving).toBe(false)
  await waitFor(() => expect(appContainer.resolve('mockDb').drafts[key].aiPrompt)
    .toBe('다음 장면을 이어 써 주세요'))
})

it('shows saving when the demo memo is edited', async () => {
  render(<Provider store={createAppStore({ role: 'user' })}>
    <MemoryRouter initialEntries={['/studio/starlight?view=memo']}>
      <Routes><Route path="/studio/:id" element={<StudioPage />} /></Routes>
    </MemoryRouter>
  </Provider>)
  fireEvent.change(await screen.findByLabelText('콘티 내용'), { target: { value: '다음 장면 메모' } })
  expect(screen.getByText('저장 중…')).toBeTruthy()
  await waitFor(() => expect(work().memo).toBe('다음 장면 메모'))
})

it('serializes note and cover saves and reports a failed save separately', async () => {
  const { result } = await hook()
  const pending = deferred()
  const saves = vi.spyOn(api(), 'saveNotes').mockImplementationOnce(async () => {
    await pending.promise
    throw new Error('메모 저장 실패')
  })

  const memo = result.current.saveNotes({ memo: '저장할 메모' })
  const cover = result.current.saveNotes({ coverImg: 'new-cover' })
  try {
    await waitFor(() => expect(saves).toHaveBeenCalledOnce())
  } finally {
    await act(async () => {
      pending.resolve()
      expect(await memo).toBe(false)
      expect(await cover).toBe(true)
    })
  }
  expect(saves).toHaveBeenCalledTimes(2)
  expect(work().coverImg).toBe('new-cover')
  expect(result.current.saving).toBe(false)

  saves.mockRejectedValueOnce(new Error('표지 저장 실패'))
  await act(async () => {
    expect(await result.current.saveNotes({ coverImg: null })).toBe(false)
  })
  expect(result.current.notesSaveFailed).toBe(true)
  expect(work().coverImg).toBe('new-cover')

  await act(async () => {
    expect(await result.current.saveNotes({ coverImg: null })).toBe(true)
  })
  expect(result.current.notesSaveFailed).toBe(false)
  expect(work().coverImg).toBeNull()
  expect(saves).toHaveBeenLastCalledWith('starlight', { coverImg: null })
})

it('keeps a reverted body stale before reload and when a recheck is cancelled or fails', async () => {
  const key = 'starlight'
  const original = ['해가 진 뒤 탑의 문이 열렸다.']
  await api().open(key, undefined, 'user')
  await api().edit(key, { paras: original })
  await api().check(key, key)
  const { result } = await hook()

  act(() => result.current.edit({ paras: ['바뀐 원고'] }))
  expect(result.current.checkStale).toBe(true)
  act(() => result.current.edit({ paras: original }))
  expect(result.current.checkStale).toBe(true)

  vi.mocked(window.confirm).mockReturnValueOnce(false)
  await act(async () => { expect(await result.current.check()).toBe(false) })
  expect(result.current.checkStale).toBe(true)

  vi.spyOn(api(), 'check').mockRejectedValueOnce(new Error('검사 실패'))
  await act(async () => { expect(await result.current.check()).toBe(false) })
  expect(result.current.checkStale).toBe(true)

  await act(async () => { expect(await result.current.check()).toBe(true) })
  await waitFor(() => expect(result.current.checkStale).toBe(false))
})

it('saves an edit made during a check after the check and keeps its result stale', async () => {
  const key = 'starlight'
  await api().open(key, undefined, 'user')
  await api().edit(key, { paras: ['검사할 원고'] })
  const { result } = await hook()
  const pending = deferred()
  const check = api().check.bind(api())
  const checking = vi.spyOn(api(), 'check').mockImplementation((...args) =>
    pending.promise.then(() => check(...args)))
  let request: Promise<boolean> | undefined
  act(() => { request = result.current.check() })
  try {
    await waitFor(() => expect(checking).toHaveBeenCalledOnce())
    await act(async () => result.current.edit({ paras: ['검사 중 추가한 원고'] }))
    expect(appContainer.resolve('mockDb').drafts[key].paras).toEqual(['검사할 원고'])
  } finally {
    await act(async () => { pending.resolve(); await request })
  }

  await waitFor(() => expect(result.current.draft?.paras).toEqual(['검사 중 추가한 원고']))
  expect(result.current.checkStale).toBe(true)
  expect(appContainer.resolve('mockDb').drafts[key].check?.stale).toBe(true)
})

it('shows the stale check in the publish sheet without blocking publication', async () => {
  const key = 'starlight'
  await api().open(key, undefined, 'user')
  await api().edit(key, { paras: ['검사할 원고'] })
  await api().check(key, key)
  await api().edit(key, { paras: ['검사 후 바꾼 원고'] })
  render(wrapper({ children: <Routes><Route path="/studio/:id" element={<StudioPage />} /></Routes> }))
  fireEvent.click(await screen.findByRole('button', { name: '공개하기' }))
  const sheet = await screen.findByRole('dialog', { name: /화 공개하기$/ })
  expect(within(sheet).getByText('원고가 변경됐어요. 다시 검사해 주세요.')).toBeTruthy()
  expect(within(sheet).getByRole('button', { name: '공개하기' }).hasAttribute('disabled')).toBe(false)
})

it('reloads the draft if a check refresh captured it before a later edit', async () => {
  const key = 'starlight'
  await api().open(key, undefined, 'user')
  await api().edit(key, { paras: ['검사할 원고'] })
  const { result } = await hook()
  const snapshotRead = deferred()
  const response = deferred()
  const open = api().open.bind(api())
  vi.spyOn(api(), 'open').mockImplementation(async (...args) => {
    const snapshot = await open(...args)
    if (snapshot && !('notMine' in snapshot) && snapshot.draft.check?.stale === false) {
      snapshotRead.resolve()
      await response.promise
    }
    return snapshot
  })

  await act(async () => { expect(await result.current.check()).toBe(true) })
  try {
    await snapshotRead.promise
    await act(async () => result.current.edit({ paras: ['재조회 중 추가한 원고'] }))
  } finally {
    await act(async () => { response.resolve() })
  }

  await waitFor(() => expect(result.current.draft?.paras).toEqual(['재조회 중 추가한 원고']))
  expect(result.current.checkStale).toBe(true)
})

it('preserves a failed body edit for the next save and prevents checking or publishing the older body', async () => {
  const key = 'starlight'
  await api().open(key, undefined, 'user')
  await api().edit(key, { paras: ['저장된 원고'] })
  await api().check(key, key)
  const { result } = await hook()
  vi.spyOn(api(), 'edit').mockRejectedValueOnce(new Error('저장 실패'))
  const check = vi.spyOn(api(), 'check')
  const publish = vi.spyOn(api(), 'publish')

  await act(async () => result.current.edit({ paras: ['실패한 원고 입력'] }))
  await act(async () => {
    expect(await result.current.check()).toBe(false)
    await result.current.publish('공개 제목')
  })
  expect(check).not.toHaveBeenCalled()
  expect(publish).not.toHaveBeenCalled()
  expect(result.current.checkStale).toBe(true)

  await act(async () => result.current.setPrompt('재저장할 요청'))
  await waitFor(() => expect(appContainer.resolve('mockDb').drafts[key]).toMatchObject({
    paras: ['실패한 원고 입력'],
    aiPrompt: '재저장할 요청',
    check: { stale: true },
  }))
})

it('allows a draft edit after a queued wiki save fails', async () => {
  const { result } = await hook()
  const key = result.current.studio!.key
  vi.spyOn(api(), 'setDocText').mockRejectedValueOnce(new Error('사전 저장 실패'))
  await act(async () => {
    await expect(result.current.setDocText('demo-doc', 'body', '설정')).rejects.toThrow('사전 저장 실패')
    result.current.edit({ title: '계속 저장할 제목' })
  })
  await waitFor(() => expect(appContainer.resolve('mockDb').drafts[key].title).toBe('계속 저장할 제목'))
})

it.each([undefined, 1])('publishes a draft only once during repeated calls (editing episode %s)', async ep => {
  const { result } = await hook(ep)
  act(() => result.current.edit({ paras: ['중복 없이 발행할 원고'] }))
  const beforeEpisodes = work().eps.length
  const beforeEvents = work().ownEvents?.length ?? 0
  const pending = deferred()
  const publish = api().publish.bind(api())
  const send = vi.spyOn(api(), 'publish').mockImplementation((...args) => pending.promise.then(() => publish(...args)))
  const calls: Promise<unknown>[] = []
  act(() => { calls.push(result.current.publish('검증 제목'), result.current.publish('검증 제목')) })
  try {
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(result.current.publishBusy).toBe(true)
  } finally {
    await act(async () => { pending.resolve(); await Promise.all(calls) })
  }
  expect(work().eps).toHaveLength(beforeEpisodes + (ep ? 0 : 1))
  expect(work().ownEvents).toHaveLength(beforeEvents + 1)
  expect(result.current.publishBusy).toBe(false)
})

it('blocks duplicate auto generation and manual publication until generation completes', async () => {
  await api().toggleAuto('starlight')
  await api().setAuto('starlight', 'requireReview', false)
  const { result } = await hook()
  const count = work().eps.length
  const pending = deferred()
  const generate = api().autoGen.bind(api())
  const send = vi.spyOn(api(), 'autoGen').mockImplementation((...args) => pending.promise.then(() => generate(...args)))
  const publish = vi.spyOn(api(), 'publish')
  const calls: Promise<unknown>[] = []
  act(() => { calls.push(result.current.autoGen(), result.current.autoGen(), result.current.publish('중복 요청')) })
  try {
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(publish).not.toHaveBeenCalled()
    expect(result.current.autoGenerating).toBe(true)
  } finally {
    await act(async () => { pending.resolve(); await Promise.all(calls) })
  }
  expect(work().eps).toHaveLength(count + 1)
  expect(result.current.autoGenerating).toBe(false)
})

it.each(['exception', 'refusal'])('allows publication retry after %s', async kind => {
  const { result } = await hook()
  const send = vi.spyOn(api(), 'publish')
  if (kind === 'exception') send.mockRejectedValueOnce(new Error('저장 실패'))
  else send.mockResolvedValueOnce({ error: '공개 거부' })
  send.mockResolvedValueOnce({ ok: '재시도 성공', go: '/work/starlight' })
  await act(async () => { await result.current.publish('제목') })
  expect(result.current.publishBusy).toBe(false)
  await act(async () => { await result.current.publish('제목') })
  expect(send).toHaveBeenCalledTimes(2)
})

it('allows generation retry after an exception', async () => {
  const { result } = await hook()
  const send = vi.spyOn(api(), 'autoGen').mockRejectedValueOnce(new Error('생성 실패')).mockResolvedValueOnce(null)
  await act(async () => { await result.current.autoGen() })
  expect(result.current.autoGenerating).toBe(false)
  await act(async () => { await result.current.autoGen() })
  expect(send).toHaveBeenCalledTimes(2)
})

it.each([false, true])('uses the refreshed title unless the user edited the publication title (%s)', async edited => {
  render(wrapper({ children: <Routes><Route path="/studio/:id" element={<StudioPage />} /><Route path="/work/:id" element={<p>발행 결과</p>} /></Routes> }))
  const editor = await screen.findByLabelText('원고 본문')
  const open = api().open.bind(api())
  const refresh = deferred()
  vi.spyOn(api(), 'open').mockImplementation((...args) => refresh.promise.then(() => open(...args)))
  fireEvent.input(screen.getByLabelText('회차 제목'), { target: { value: '저장 큐의 최신 제목' } })
  editor.innerHTML = '<p>공개할 원고</p>'
  fireEvent.input(editor)
  fireEvent.click(screen.getByRole('button', { name: '공개하기' }))
  const sheet = await screen.findByRole('dialog', { name: /화 공개하기$/ })
  const title = within(sheet).getByLabelText('회차 제목') as HTMLInputElement
  if (edited) fireEvent.change(title, { target: { value: '공개 시트에서 고친 제목' } })
  await act(async () => { refresh.resolve() })
  const expected = edited ? '공개 시트에서 고친 제목' : '저장 큐의 최신 제목'
  await waitFor(() => expect(title.value).toBe(expected))
  const pending = deferred()
  const publish = api().publish.bind(api())
  const send = vi.spyOn(api(), 'publish').mockImplementation((...args) => pending.promise.then(() => publish(...args)))
  const button = within(sheet).getByRole('button', { name: '공개하기' }) as HTMLButtonElement
  fireEvent.click(button)
  fireEvent.click(button)
  try {
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(button.disabled).toBe(true)
    expect((within(sheet).getByRole('button', { name: '취소' }) as HTMLButtonElement).disabled).toBe(true)
    expect(title.disabled).toBe(true)
  } finally {
    await act(async () => { pending.resolve() })
  }
  await screen.findByText('발행 결과')
  expect(work().eps.at(-1)?.t).toBe(expected)
})

it('publishes the latest saved title even before the sheet refresh finishes', async () => {
  const initial = await api().open('starlight', undefined, 'user')
  if (!initial || 'notMine' in initial) throw new Error('초안을 열지 못했어요')
  await api().edit(initial.key, { paras: ['기존 작성 원고'] })
  render(wrapper({ children: <Routes><Route path="/studio/:id" element={<StudioPage />} /><Route path="/work/:id" element={<p>발행 결과</p>} /></Routes> }))
  const editor = await screen.findByLabelText('원고 본문')
  const open = api().open.bind(api())
  const refresh = deferred()
  vi.spyOn(api(), 'open').mockImplementation((...args) => refresh.promise.then(() => open(...args)))
  fireEvent.input(screen.getByLabelText('회차 제목'), { target: { value: '즉시 공개할 최신 제목' } })
  editor.innerHTML = '<p>즉시 공개할 원고</p>'
  fireEvent.input(editor)
  fireEvent.click(screen.getByRole('button', { name: '공개하기' }))
  try {
    const sheet = await screen.findByRole('dialog', { name: /화 공개하기$/ })
    fireEvent.click(within(sheet).getByRole('button', { name: '공개하기' }))
    await screen.findByText('발행 결과')
    expect(work().eps.at(-1)?.t).toBe('즉시 공개할 최신 제목')
  } finally {
    await act(async () => { refresh.resolve() })
  }
})

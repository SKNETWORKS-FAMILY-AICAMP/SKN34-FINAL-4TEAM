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

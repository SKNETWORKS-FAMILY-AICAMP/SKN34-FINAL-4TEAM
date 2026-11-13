// @vitest-environment jsdom
// CI integration: 데모 캐릭터챗은 답을 기다리는 동안 다시 보내지 않고, 대화 상대가 바뀌거나 화면을 떠나면 대기 중인 답을 취소하며 그 질문에 취소 안내를 남긴다.
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { createFixtureDb } from '../../../../data/mock/fixtureDb'
import { InMemoryChatRepository, InMemoryReadingRepository, InMemoryWorkRepository } from '../../../../data/mock/InMemoryRepositories'
import { ChatUseCase } from '../../../../domain/usecases/ChatUseCase'
import { useChatViewModel } from './useChatViewModel'

afterEach(() => { cleanup(); vi.useRealTimers() })

// #47
it('답을 기다리는 동안 다시 보내지 않고 대화 상대가 바뀌거나 화면을 떠나면 대기 중인 답을 취소하고 취소 안내를 남긴다', async () => {
  vi.useFakeTimers()
  const db = createFixtureDb(), store = createAppStore({ role: 'user' })
  const uc = new ChatUseCase(new InMemoryWorkRepository(db), new InMemoryReadingRepository(db), new InMemoryChatRepository(db))
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  const { result, rerender, unmount } = renderHook(({ cn }) => useChatViewModel('guunmong', cn, uc), { wrapper, initialProps: { cn: '성진' } })
  const speakers = (key: string) => db.chat[key].map((line) => line[0])
  const lastText = (key: string) => db.chat[key].at(-1)![1]
  const send = (q: number) => act(async () => { await result.current.ask({ q }) })
  const wait = () => act(async () => { await vi.advanceTimersByTimeAsync(450) })
  await act(async () => {})
  await send(0)
  await send(1)
  expect(speakers('guunmong/성진')).toEqual(['성진', '나'])
  rerender({ cn: '육관대사' })
  await act(async () => {})
  await wait()
  expect(speakers('guunmong/성진')).toEqual(['성진', '나', '성진'])
  expect(lastText('guunmong/성진')).toContain('취소')
  await send(0)
  await wait()
  expect(speakers('guunmong/육관대사')).toEqual(['육관대사', '나', '육관대사'])
  // 답이 이미 도착한 대화는 떠나도 취소 안내가 붙지 않는다.
  rerender({ cn: '성진' })
  await act(async () => {})
  rerender({ cn: '육관대사' })
  await act(async () => {})
  expect(speakers('guunmong/육관대사')).toEqual(['육관대사', '나', '육관대사'])
  await send(1)
  unmount()
  await wait()
  expect(speakers('guunmong/육관대사')).toEqual(['육관대사', '나', '육관대사', '나', '육관대사'])
  expect(lastText('guunmong/육관대사')).toContain('취소')
})

// #47: 답을 만드는 요청(실서버 모드에서는 작품 조회 HTTP)이 끝나기 전에 대화가 바뀌면 늦게 온 결과를 버린다.
it('답을 만드는 사이 대화 상대가 바뀌면 새 대화는 막히지 않고 늦게 온 결과는 이전 대화에 남지 않는다', async () => {
  vi.useFakeTimers()
  const db = createFixtureDb(), store = createAppStore({ role: 'user' })
  const uc = new ChatUseCase(new InMemoryWorkRepository(db), new InMemoryReadingRepository(db), new InMemoryChatRepository(db))
  let finish: (answer: Awaited<ReturnType<ChatUseCase['answer']>>) => void = () => {}
  vi.spyOn(uc, 'answer').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  const { result, rerender } = renderHook(({ cn }) => useChatViewModel('guunmong', cn, uc), { wrapper, initialProps: { cn: '성진' } })
  const speakers = (key: string) => db.chat[key].map((line) => line[0])
  await act(async () => {})
  let late: Promise<unknown> = Promise.resolve()
  act(() => { late = result.current.ask({ q: 0 }) })
  rerender({ cn: '육관대사' })
  await act(async () => {})
  await act(async () => { await result.current.ask({ q: 0 }) })
  await act(async () => { finish({ question: '늦은 질문', reply: ['성진', '늦은 답'] }); await late })
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(speakers('guunmong/성진')).toEqual(['성진'])
  expect(speakers('guunmong/육관대사')).toEqual(['육관대사', '나', '육관대사'])
})

// 실서버 모드에서 대화방 조회는 작품 목록 HTTP를 다시 부른다. 질문·답 한 줄마다 다시 읽지 않고 화면 기록에만 덧붙인다.
it('질문과 답을 화면 기록에 덧붙일 때 대화방을 다시 읽지 않는다', async () => {
  vi.useFakeTimers()
  const db = createFixtureDb(), store = createAppStore({ role: 'user' })
  const uc = new ChatUseCase(new InMemoryWorkRepository(db), new InMemoryReadingRepository(db), new InMemoryChatRepository(db))
  const page = vi.spyOn(uc, 'page')
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  const { result } = renderHook(() => useChatViewModel('guunmong', '성진', uc), { wrapper })
  const shown = () => result.current.data?.log.map((line) => line[0])
  await act(async () => {})
  expect(shown()).toEqual(['성진'])
  await act(async () => { await result.current.ask({ q: 0 }) })
  expect(shown()).toEqual(['성진', '나'])
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(shown()).toEqual(['성진', '나', '성진'])
  expect(db.chat['guunmong/성진'].map((line) => line[0])).toEqual(['성진', '나', '성진'])
  expect(page).toHaveBeenCalledTimes(1)
  expect(store.getState().session.dataVersion).toBe(0)
})

it('빈 질문은 받지 않고 입력 오류로 남기며, 내용을 채워 다시 물으면 오류를 지운다', async () => {
  vi.useFakeTimers()
  const db = createFixtureDb(), store = createAppStore({ role: 'user' })
  const uc = new ChatUseCase(new InMemoryWorkRepository(db), new InMemoryReadingRepository(db), new InMemoryChatRepository(db))
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  const { result } = renderHook(() => useChatViewModel('guunmong', '성진', uc), { wrapper })
  await act(async () => {})
  expect(result.current.askError).toBe('')
  await act(async () => { expect(await result.current.ask({ text: '   ' })).toBe(false) })
  expect(result.current.askError).toBe('물어볼 내용을 입력해 주세요')
  expect(db.chat['guunmong/성진']).toHaveLength(1)
  await act(async () => { expect(await result.current.ask({ text: '안녕하세요' })).toBe(true) })
  expect(result.current.askError).toBe('')
})

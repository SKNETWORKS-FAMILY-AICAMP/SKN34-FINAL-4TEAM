// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { useNodePointer } from './useNodePointer'

type Node = { id: string; always?: boolean }
/** 이름을 늘 그리는 노드(`always`)와 가리킨 노드만 이름이 보인다(지도의 `showsLabel`과 같은 모양). */
const labelShown = (node: Node, shown?: string) => !!node.always || node.id === shown

// jsdom에는 matchMedia가 없다. 거친 포인터(터치 기기)인지만 답하는 대역을 두고 끝나면 지운다.
const pointerIs = (coarse: boolean) => Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }) })
afterEach(() => { Reflect.deleteProperty(window, 'matchMedia') })

const setup = (coarse: boolean) => {
  pointerIs(coarse)
  const onOpen = vi.fn()
  const { result } = renderHook(() => useNodePointer<Node>(labelShown, onOpen))
  return { onOpen, result }
}

it('마우스는 지도 이동·노드 끌기를 켜 두고 올린 노드의 이름을 보이며 누르면 바로 연다', () => {
  const { onOpen, result } = setup(false)
  expect(result.current.coarse).toBe(false)
  expect([result.current.graphProps.enablePanInteraction, result.current.graphProps.enableNodeDrag]).toEqual([true, true])
  act(() => result.current.graphProps.onNodeHover?.({ id: 'world-1' }))
  expect(result.current.shown).toBe('world-1')
  act(() => result.current.graphProps.onNodeHover?.(null))
  expect(result.current.shown).toBeUndefined()
  act(() => result.current.graphProps.onNodeClick({ id: 'world-2' })) // 이름이 아직 안 보여도 마우스는 바로 연다
  expect(onOpen.mock.calls).toEqual([[{ id: 'world-2' }]])
})

it('터치 기기는 한 손가락 끌기가 페이지 스크롤이 되도록 지도 이동·노드 끌기를 끄고 올리기를 쓰지 않는다', () => {
  const { result } = setup(true)
  expect(result.current.coarse).toBe(true)
  expect([result.current.graphProps.enablePanInteraction, result.current.graphProps.enableNodeDrag]).toEqual([false, false])
  expect(result.current.graphProps.onNodeHover).toBeUndefined()
})

it('터치에서 이름이 숨은 노드는 첫 탭에 이름만 보이고 같은 노드를 다시 누르면 열며, 이름이 늘 보이는 노드는 바로 연다', () => {
  const { onOpen, result } = setup(true)
  act(() => result.current.graphProps.onNodeClick({ id: 'world-1' }))
  expect([result.current.shown, onOpen.mock.calls.length]).toEqual(['world-1', 0])
  act(() => result.current.graphProps.onNodeClick({ id: 'world-2' })) // 다른 노드를 누르면 그 노드의 이름으로 옮긴다
  expect([result.current.shown, onOpen.mock.calls.length]).toEqual(['world-2', 0])
  act(() => result.current.graphProps.onNodeClick({ id: 'world-2' }))
  expect(onOpen.mock.calls).toEqual([[{ id: 'world-2' }]])
  act(() => result.current.graphProps.onNodeClick({ id: 'genre', always: true }))
  expect(onOpen.mock.calls).toEqual([[{ id: 'world-2' }], [{ id: 'genre', always: true }]])
})

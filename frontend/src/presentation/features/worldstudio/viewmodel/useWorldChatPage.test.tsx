// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'

import { useWorldChatPage } from './useWorldChatPage'

const setting = (id: string, title: string, text: string) => ({ item: { id, title, text } })
const vmOf = (over: object = {}) => ({
  editing: { settings: [setting('k', '카엘', '북문을 지키는 기사'), setting('n', '새 설정', '아직 저장 전')] },
  saved: { settings: [setting('k', '카엘', '북문을 지키는 기사')] },
  selected: 'k', reviewWorldId: 'w1', dirty: false, relationDirty: false, ...over,
}) as unknown as Parameters<typeof useWorldChatPage>[0]
const page = (vm: Parameters<typeof useWorldChatPage>[0], url = '/worldstudio/w1?card=k&view=people') =>
  renderHook(() => useWorldChatPage(vm), { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter> }).result.current

it('열린 저장된 카드의 세계관·카드·보기를 싣고, 저장하지 않은 변경이 없으면 편집 내용은 싣지 않는다', () => {
  expect(page(vmOf()).getPage()).toEqual({ path: '/worldstudio/w1?card=k&view=people', kind: 'world', worldId: 'w1', cardId: 'k', view: 'people' })
})

it('저장하지 않은 변경이 있으면 열린 카드의 이름·설명을 저장하지 않은 편집 내용으로 싣는다', () => {
  expect(page(vmOf({ dirty: true })).getPage().content).toEqual({ title: '카엘', body: '북문을 지키는 기사', unsaved: true })
})

it('아직 저장하지 않은 새 카드의 id는 싣지 않는다(서버가 그 세계관의 카드가 아니라고 메시지를 거절한다)', () => {
  const sent = page(vmOf({ selected: 'n', dirty: true })).getPage()
  expect(sent.cardId).toBeUndefined()
  expect(sent.content).toMatchObject({ title: '새 설정', unsaved: true })
})

it('카드가 열려 있지 않은 설정집 화면은 세계관만 싣고, 승인 카드는 카드의 수정 전 값을 찾고 변경이 있으면 승인을 막는다', () => {
  const chat = page(vmOf({ selected: '', relationDirty: true }), '/worldstudio/w1')
  expect(chat.getPage()).toEqual({ path: '/worldstudio/w1', kind: 'world', worldId: 'w1' })
  expect(chat.cardOf('k')).toEqual({ title: '카엘', body: '북문을 지키는 기사' })
  expect(chat.cardOf('x')).toBeUndefined()
  expect(chat.unsaved).toBe(true)
})

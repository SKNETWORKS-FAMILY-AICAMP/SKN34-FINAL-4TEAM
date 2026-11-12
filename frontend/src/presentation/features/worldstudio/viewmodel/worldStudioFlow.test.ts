import { expect, it } from 'vitest'

import { initialWorldStudioFlow, MANAGE_TABS, parseManageTab, studioMode, worldStudioFlow } from './worldStudioFlow'

it('keeps the authoring step through the separate library and can skip relationships', () => {
  const cards = worldStudioFlow(initialWorldStudioFlow, { type: 'step', step: 'cards' })
  const library = worldStudioFlow(cards, { type: 'list' })
  expect(worldStudioFlow(library, { type: 'resume' })).toEqual(cards)
  expect(worldStudioFlow(cards, { type: 'step', step: 'review' })).toEqual({ screen: 'editor', step: 'review' })
})

it('returns to the library when the loaded world is cleared and opens a newly loaded world at step one', () => {
  const editing = worldStudioFlow(initialWorldStudioFlow, { type: 'step', step: 'review' })
  expect(worldStudioFlow(editing, { type: 'world', id: undefined })).toEqual(initialWorldStudioFlow)
  expect(worldStudioFlow(editing, { type: 'world', id: 'another-world' })).toEqual({ screen: 'editor', step: 'info' })
})

it('treats only a world just created from the creation screen (?new=1) as write mode and every other entry, even a never-saved one, as manage mode', () => {
  const at = (query: string) => studioMode(new URLSearchParams(query))
  expect(at('new=1')).toBe('write') // 새 세계관 만들기 직후
  expect(at('new=1&tab=book')).toBe('write')
  expect(at('')).toBe('manage') // 서재 '관리하기'·직접 주소(저장 버전 0인 세계관 포함)
  expect(at('tab=people')).toBe('manage')
  for (const query of ['new=0', 'new=', 'new=true', 'NEW=1']) expect(at(query), query).toBe('manage')
})

it('lists the five manage tabs in order and reads ?tab= as one of them, falling back to the settings book', () => {
  expect(MANAGE_TABS.map(([id, label]) => [id, label])).toEqual([['book', '설정집'], ['people', '인물 관계도'], ['explore', '세계관 탐색'], ['analysis', 'AI 후보 검토'], ['versions', '확정 버전']])
  expect(['book', 'people', 'explore', 'analysis', 'versions'].map(parseManageTab)).toEqual(['book', 'people', 'explore', 'analysis', 'versions'])
  expect([null, '', 'steps', 'BOOK', 'write'].map(parseManageTab)).toEqual(['book', 'book', 'book', 'book', 'book'])
})

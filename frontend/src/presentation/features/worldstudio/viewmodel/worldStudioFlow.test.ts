import { expect, it } from 'vitest'

import { initialWorldStudioFlow, legacyTabTarget, MANAGE_VIEWS, parseManageView, studioMode, worldStudioFlow } from './worldStudioFlow'

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

it('lists the manage views (settings book · character relations · timeline) in order and reads ?view= as one of them, falling back to the settings book', () => {
  expect(MANAGE_VIEWS.map(([id, label]) => [id, label])).toEqual([['book', '설정집'], ['people', '인물 관계도'], ['timeline', '시간선']])
  expect(['book', 'people', 'timeline'].map(parseManageView)).toEqual(['book', 'people', 'timeline'])
  expect([null, '', 'steps', 'BOOK', 'write', 'explore', 'analysis'].map(parseManageView)).toEqual(['book', 'book', 'book', 'book', 'book', 'book', 'book'])
})

it('moves an old ?tab= address to the view or sheet that replaced that tab', () => {
  expect(legacyTabTarget(null)).toBeNull() // 옛 값이 없으면 손대지 않는다
  expect(['book', 'people', 'analysis', 'versions', 'explore', 'nope', ''].map(legacyTabTarget)).toEqual([
    { view: 'book', review: false },
    { view: 'people', review: false },
    { view: 'book', review: true }, // AI 후보 검토는 시트가 됐다
    { view: 'book', review: false }, // 확정 버전은 편집 화면의 버전 그래프로 옮겨 갔다
    { view: 'book', review: false }, // 세계관 탐색은 없어졌다
    { view: 'book', review: false },
    { view: 'book', review: false },
  ])
})

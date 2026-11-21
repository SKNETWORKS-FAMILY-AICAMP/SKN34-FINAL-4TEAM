// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearFilter, loadFilter, relationKey, saveFilter } from './relationPrefs'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

it('필터는 세계관마다 따로 저장·복원하고 저장한 적이 없으면 null이며 초기화하면 지워진다', () => {
  expect(loadFilter('w1')).toBeNull()
  saveFilter('w1', { hiddenTypes: ['location'], hiddenKinds: ['목격'] })
  expect(loadFilter('w1')).toEqual({ hiddenTypes: ['location'], hiddenKinds: ['목격'] })
  expect(loadFilter('w2')).toBeNull()
  clearFilter('w1')
  expect(loadFilter('w1')).toBeNull()
})

it('깨진 값·모양이 다른 값은 저장한 적이 없는 것으로 읽는다', () => {
  localStorage.setItem(relationKey('w1'), '{oops')
  expect(loadFilter('w1')).toBeNull()
  localStorage.setItem(relationKey('w1'), JSON.stringify({ hiddenTypes: 'location', hiddenKinds: [] }))
  expect(loadFilter('w1')).toBeNull()
})

it('저장소를 쓸 수 없어도(용량 초과·차단) 던지지 않는다 — 화면 보기는 계속된다', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  expect(() => saveFilter('w1', { hiddenTypes: [], hiddenKinds: [] })).not.toThrow()
  expect(loadFilter('w1')).toBeNull()
})

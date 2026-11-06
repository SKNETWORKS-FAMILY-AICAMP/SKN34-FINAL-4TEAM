// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { ImportPage } from './ImportPage'

const vm = vi.hoisted(() => ({
  step: 5, done: true, running: false, picked: true, kind: '자체 창작', ok: true, world: 'w1',
  myWorlds: [{ id: 'w1', name: '내 세계' }],
  result: { cast: ['성춘향 · 주인공', '이몽룡 · 상대역'], world: ['규칙 밤에는 문이 닫힌다', '장소 광한루'], events: ['1 광한루에서 만남'] },
  pick: vi.fn(), setKind: vi.fn(), setOk: vi.fn(), setWorld: vi.fn(), edit: vi.fn(), start: vi.fn(), rerun: vi.fn(), save: vi.fn(),
}))
vi.mock('../viewmodel/useImportViewModel', () => ({ useImportViewModel: () => vm }))
vi.mock('../../../shared/shell/Gnb', () => ({ Gnb: () => null, Footer: () => null }))

afterEach(() => { cleanup(); vi.clearAllMocks(); document.title = 'STORYFORK' })

const renderImport = () => render(<MemoryRouter><ImportPage /></MemoryRouter>)

it('정리 결과 항목은 이름이 있는 텍스트 상자로 키보드에서 닿고 목록 구조를 지킨다', () => {
  renderImport()
  const box = screen.getByRole('textbox', { name: '인물 1' })
  expect(box.tabIndex).toBe(0)
  expect(screen.getByRole('textbox', { name: '세계관 2' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: '사건 1' })).toBeTruthy()
  for (const list of document.querySelectorAll('.res3 ul')) {
    expect([...list.children].every((child) => child.tagName === 'LI')).toBe(true)
  }
  expect(within(box.closest('ul')!).getAllByRole('listitem')).toHaveLength(2)
})

it('항목을 고치고 포커스를 잃으면 그 항목만 저장한다', () => {
  renderImport()
  const box = screen.getByRole('textbox', { name: '세계관 2' })
  box.textContent = '장소 남원'
  fireEvent.blur(box)
  expect(vm.edit).toHaveBeenCalledTimes(1)
  expect(vm.edit).toHaveBeenCalledWith('world', 1, '장소 남원')
})

it('가져오기 화면은 h1 하나와 건너뛰기 링크가 닿는 main을 가진다', () => {
  renderImport()
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['내 소설 가져오기'])
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.getByRole('main').id).toBe('main')
  expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1')
})

it('탭 제목에 소설 가져오기를 쓴다', () => {
  renderImport()
  expect(document.title).toBe('소설 가져오기 · STORYFORK')
})

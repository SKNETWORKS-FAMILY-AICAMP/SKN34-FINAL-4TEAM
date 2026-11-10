// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { NewWorkPage } from './NewWorkPage'

const vm = vi.hoisted(() => ({
  policyAccepted: false, acceptPolicy: vi.fn(), addTag: vi.fn(() => true),
  form: { title: '', genre: '', schedule: [], rating: '일반', summary: '', tags: [], cover: '', localRules: '', cast: [], fork: '0' },
}))
vi.mock('../viewmodel/useNewWorkViewModel', () => ({ useNewWorkViewModel: () => vm }))
vi.mock('../../../shared/shell/Gnb', () => ({ Gnb: () => null, Footer: () => null }))

afterEach(() => { cleanup(); vi.clearAllMocks(); vm.policyAccepted = false; document.title = 'STORYFORK' })

const renderNewWork = () => render(<MemoryRouter><NewWorkPage /></MemoryRouter>)

it('새 소설 화면은 h1 하나와 건너뛰기 링크가 닿는 main을 가진다', () => {
  renderNewWork()
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['집필 전 정책 확인'])
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.getByRole('main').id).toBe('main')
  expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1')
})

it('탭 제목에 새 소설 만들기를 쓴다', () => {
  renderNewWork()
  expect(document.title).toBe('새 소설 만들기 · STORYFORK')
})

it('태그 입력은 조합 중 Enter와 Safari의 조합 확정 Enter(isComposing=false, keyCode=229)로 추가하지 않는다', () => {
  vm.policyAccepted = true
  renderNewWork()
  const input = screen.getByLabelText('직접 입력')
  fireEvent.change(input, { target: { value: '모험' } })
  for (const init of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
    expect(fireEvent.keyDown(input, { key: 'Enter', ...init })).toBe(true)
    expect(vm.addTag).not.toHaveBeenCalled()
  }
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
  expect(vm.addTag).toHaveBeenCalledWith('모험')
})

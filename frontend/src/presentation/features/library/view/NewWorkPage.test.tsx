// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { NewWorkPage } from './NewWorkPage'

vi.mock('../viewmodel/useNewWorkViewModel', () => ({ useNewWorkViewModel: () => ({ policyAccepted: false, acceptPolicy: vi.fn() }) }))
vi.mock('../../../shared/shell/Gnb', () => ({ Gnb: () => null, Footer: () => null }))

afterEach(() => { cleanup(); document.title = 'STORYFORK' })

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

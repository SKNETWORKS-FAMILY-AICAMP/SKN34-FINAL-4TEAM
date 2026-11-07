// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { WritingPolicyPage } from './WritingPolicyPage'

vi.mock('../../../shared/shell/Gnb', () => ({ Gnb: () => null, Footer: () => null }))

afterEach(() => { cleanup(); document.title = 'STORYFORK' })

const renderPolicy = (method: 'fork' | 'import') => render(
  <Provider store={createAppStore({ role: 'user' })}>
    <MemoryRouter initialEntries={[`/writing-policy?method=${method}`]}><WritingPolicyPage /></MemoryRouter>
  </Provider>,
)

it.each([['fork', '다른 소설 포크 전 확인'], ['import', '내 소설 가져오기 전 확인']] as const)('%s 안내는 h1 하나와 건너뛰기 링크가 닿는 main을 가진다', (method, heading) => {
  renderPolicy(method)
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([heading])
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.getByRole('main').id).toBe('main')
  expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1')
})

it('탭 제목에 집필 방식·저작권 안내를 쓴다', () => {
  renderPolicy('import')
  expect(document.title).toBe('집필 방식·저작권 안내 · STORYFORK')
})

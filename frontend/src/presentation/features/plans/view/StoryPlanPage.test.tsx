// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { StoryPlanPage } from './StoryPlanPage'

vi.mock('./StoryPlanWorkspace', () => ({ StoryPlanWorkspace: () => <section aria-label="플롯 작업 영역" /> }))
afterEach(cleanup)

it('집필실 플롯 화면은 main#main과 h1 하나를 가지고 기존 집필 도구 이동을 유지한다', () => {
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><StoryPlanPage id="w" /></MemoryRouter></Provider>)
  const main = screen.getByRole('main')
  expect(main.id).toBe('main')
  expect(main.getAttribute('tabindex')).toBe('-1')
  expect(main.contains(screen.getByRole('region', { name: '플롯 작업 영역' }))).toBe(true)
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['집필실'])
  expect(screen.getByRole('link', { name: '플롯' }).getAttribute('aria-current')).toBe('page')
  expect(document.title).toBe('플롯 · STORYFORK')
})

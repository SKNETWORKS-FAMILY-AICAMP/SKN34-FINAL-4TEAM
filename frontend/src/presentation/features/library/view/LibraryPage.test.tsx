// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import '../../../../test/scrollToSpy'
import { createAppStore } from '../../../../app/store'
import { LibraryPage } from './LibraryPage'

vi.mock('./ServerWritingList', () => ({ ServerWritingList: () => null }))

afterEach(() => { cleanup(); document.title = 'STORYFORK' })

const renderLibrary = (path = '/lib') => render(
  <Provider store={createAppStore({ role: 'user' })}>
    <MemoryRouter initialEntries={[path]}><LibraryPage /></MemoryRouter>
  </Provider>,
)
const tab = (name: string) => screen.getByRole('link', { name })

it('서재 탭은 현재 탭을 aria-current로 알리고 탭을 옮기면 따라간다', async () => {
  renderLibrary()
  await screen.findByRole('link', { name: '▶ 2화 이어 읽기' })
  expect(tab('읽는 중').getAttribute('aria-current')).toBe('page')
  expect(tab('내가 쓰는 소설').hasAttribute('aria-current')).toBe(false)
  expect(tab('내 댓글·신고').hasAttribute('aria-current')).toBe(false)
  fireEvent.click(tab('내 댓글·신고'))
  await screen.findByText('작가가 처리하면 상태가 바뀌어요.')
  expect(tab('내 댓글·신고').getAttribute('aria-current')).toBe('page')
  expect(tab('읽는 중').hasAttribute('aria-current')).toBe(false)
})

it('내 서재는 h1 하나와 건너뛰기 링크가 닿는 main을 가진다', async () => {
  renderLibrary()
  await screen.findByRole('heading', { level: 1, name: '내 서재' })
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.getByRole('main').id).toBe('main')
  expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1')
})

it('탭 제목에 내 서재를 쓴다', async () => {
  renderLibrary()
  await screen.findByRole('heading', { level: 1, name: '내 서재' })
  expect(document.title).toBe('내 서재 · STORYFORK')
})

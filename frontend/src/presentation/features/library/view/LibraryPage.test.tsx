// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  expect(tab('내 댓글·제보').hasAttribute('aria-current')).toBe(false)
  fireEvent.click(tab('내 댓글·제보'))
  await screen.findByText('작가가 처리하면 상태가 바뀌어요.')
  expect(tab('내 댓글·제보').getAttribute('aria-current')).toBe('page')
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

it('서버 연결 빌드는 이어 읽기 기록과 관심 소설이 계정에 저장된다고 안내한다', async () => {
  renderLibrary()
  const note = await screen.findByText(/이어 읽기 기록과 관심 소설은 계정에 저장돼요/)
  expect(note.textContent).not.toContain('이 창에서만')
})

it('서버가 없는 목업 빌드는 읽기 기록도 이 창에서만 유지된다고 안내한다', async () => {
  vi.stubEnv('MODE', 'mockup')
  try {
    renderLibrary()
    const note = await screen.findByText(/읽기 기록과 관심 소설은 이 창에서만 유지돼요/)
    expect(note.textContent).not.toContain('계정에 저장돼요')
  } finally { vi.unstubAllEnvs() }
})

it('이어 읽기 목록의 기록 삭제 버튼은 그 작품의 기록만 지우고 목록에서 뺀다', async () => {
  renderLibrary()
  const del = await screen.findByRole('button', { name: '구운몽 이어 읽기 기록 삭제' })
  screen.getByRole('button', { name: '별빛 서약의 탑 이어 읽기 기록 삭제' })
  fireEvent.click(del)
  await waitFor(() => expect(screen.queryByRole('button', { name: '구운몽 이어 읽기 기록 삭제' })).toBeNull())
  expect(screen.queryByRole('link', { name: '▶ 2화 이어 읽기' })).toBeNull()
  screen.getByRole('link', { name: '▶ 1화 이어 읽기' })
})

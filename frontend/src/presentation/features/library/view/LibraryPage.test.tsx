// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import '../../../../test/scrollToSpy'
import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { LibraryPage } from './LibraryPage'
import * as events from '../../../shared/events'

// 제목 줄 '+ 새 소설' 버튼은 LibraryPage가 넘기는 newTo로 간다(아래 시험이 이 대역으로 받은 값을 본다).
const writing = vi.hoisted(() => vi.fn((_props: { newTo: string }) => null))
vi.mock('./ServerWritingList', () => ({ ServerWritingList: writing }))
vi.mock('./MyWorlds', () => ({ MyWorlds: () => null }))

afterEach(() => { cleanup(); document.title = 'STORYFORK' })

const renderLibrary = (path: string | { pathname: string; search: string; state: { deletedWorkTitle: string } } = '/lib') => render(
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
  fireEvent.click(tab('내가 쓰는 소설'))
  await screen.findByRole('heading', { name: '새로 시작하기' })
  expect(tab('내가 쓰는 소설').getAttribute('aria-current')).toBe('page')
  expect(tab('읽는 중').hasAttribute('aria-current')).toBe(false)
})

it.each([['test', '/content'], ['mockup', '/new']])('집필 중인 작품의 제목 줄 새 소설 버튼에 넘기는 주소는 아래 새 소설 쓰기 카드와 같다: MODE=%s', async (mode, to) => {
  vi.stubEnv('MODE', mode)
  try {
    renderLibrary('/lib?tab=write')
    const card = await screen.findByRole('link', { name: /＋ 새 소설 쓰기/ })
    expect(card.getAttribute('href')).toBe(to)
    expect(writing.mock.calls.at(-1)?.[0].newTo).toBe(to)
  } finally { vi.unstubAllEnvs() }
})

it('삭제 완료는 내가 쓰는 소설 탭이 열린 뒤 한 번 안내한다', async () => {
  const notify = vi.spyOn(events, 'toast').mockImplementation(() => {
    expect(tab('내가 쓰는 소설').getAttribute('aria-current')).toBe('page')
    return true
  })
  try {
    renderLibrary({ pathname: '/lib', search: '?tab=write', state: { deletedWorkTitle: '삭제한 작품' } })
    expect(notify).not.toHaveBeenCalled()
    await screen.findByRole('heading', { name: '새로 시작하기' })
    expect(notify).toHaveBeenCalledExactlyOnceWith('「삭제한 작품」 작품을 삭제했어요.')
    fireEvent.click(tab('읽는 중'))
    await screen.findByRole('heading', { name: '이어 읽기' })
    fireEvent.click(tab('내가 쓰는 소설'))
    await screen.findByRole('heading', { name: '새로 시작하기' })
    expect(notify).toHaveBeenCalledTimes(1)
  } finally { notify.mockRestore() }
})

it('서재를 불러오지 못해도 이미 끝난 작품 삭제는 안내한다', async () => {
  const load = vi.spyOn(appContainer.resolve('libraryUseCase'), 'getWrite').mockRejectedValue(new Error('offline'))
  const notify = vi.spyOn(events, 'toast')
  try {
    renderLibrary({ pathname: '/lib', search: '?tab=write', state: { deletedWorkTitle: '삭제한 작품' } })
    await screen.findByRole('button', { name: '다시 불러오기' })
    expect(notify).toHaveBeenCalledExactlyOnceWith('「삭제한 작품」 작품을 삭제했어요.')
  } finally {
    notify.mockRestore()
    load.mockRestore()
  }
})

it('서재 탭 줄은 이름이 있는 내비게이션이라 상단 주요 메뉴와 구분된다', async () => {
  renderLibrary()
  await screen.findByRole('link', { name: '▶ 2화 이어 읽기' })
  const tabs = screen.getByRole('navigation', { name: '서재 메뉴' })
  expect(tabs.classList.contains('libtabs')).toBe(true)
  expect(Array.from(tabs.querySelectorAll('a'), (link) => link.textContent)).toEqual(['읽는 중', '내가 쓰는 소설', '내가 만드는 세계관'])
})

it('서재 탭은 읽는 중 · 내가 쓰는 소설 · 내가 만드는 세계관 순서이고 ?tab=worlds는 세계관 탭을 현재 탭으로 알린다', async () => {
  renderLibrary('/lib?tab=worlds')
  await waitFor(() => expect(tab('내가 만드는 세계관').getAttribute('aria-current')).toBe('page'))
  expect(Array.from(document.querySelectorAll('.libtabs a'), link => link.getAttribute('href'))).toEqual(['/lib?tab=read', '/lib?tab=write', '/lib?tab=worlds'])
  expect(tab('읽는 중').hasAttribute('aria-current')).toBe(false)
  expect(tab('내가 쓰는 소설').hasAttribute('aria-current')).toBe(false)
})

it('내 댓글·제보 탭은 없고, 예전 주소 ?tab=qa는 읽는 중 탭으로 열린다', async () => {
  renderLibrary('/lib?tab=qa')
  await screen.findByRole('link', { name: '▶ 2화 이어 읽기' })
  expect(tab('읽는 중').getAttribute('aria-current')).toBe('page')
  expect(screen.queryByRole('link', { name: '내 댓글·제보' })).toBeNull()
  expect(screen.queryByText('작가가 처리하면 상태가 바뀌어요.')).toBeNull()
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

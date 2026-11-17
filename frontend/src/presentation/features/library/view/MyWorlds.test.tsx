// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { MyWorlds } from './MyWorlds'

const api = vi.hoisted(() => ({ list: vi.fn(), supportsCover: true }))
// 올린 표지를 소유자 인증으로 읽는 공용 훅이다. 기본은 아직 읽는 중({ url: '', error: '' })이고, mockReset이 이 구현으로 되돌린다.
const cover = vi.hoisted(() => vi.fn<(useCase: unknown, worldId: string | undefined, enabled: boolean, revision: number) => { url: string; error: string }>(() => ({ url: '', error: '' })))
vi.mock('../../../../app/appContainer', () => ({ appContainer: { resolve: () => api } }))
vi.mock('../../../shared/useWorldCoverImage', () => ({ useWorldCoverImage: cover }))
afterEach(() => { cleanup(); api.list.mockReset(); api.supportsCover = true; cover.mockReset() })

const world = (index: number, settings = 2) => ({ id: `w${index}`, name: `세계 ${index}`, description: '', version: 3, settings: Array.from({ length: settings }), analysis: null })
const show = () => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><MyWorlds /></MemoryRouter></Provider>)
const names = () => screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)
const coverOf = (name: string) => screen.getByRole('heading', { level: 3, name }).closest('article')?.querySelector('img.cimg')?.getAttribute('src')

it('shows the server card count of a summary, which carries no settings', async () => {
  api.list.mockResolvedValueOnce([{ ...world(1, 0), cardCount: 7 }])
  show()
  expect(await screen.findByText('설정 7개 · 버전 3')).toBeTruthy()
})

it('lists my worlds as cards that open the world studio, with a new-world link on top', async () => {
  api.list.mockResolvedValueOnce([world(1), world(2, 5)])
  const { container } = show()
  await screen.findByRole('heading', { level: 3, name: '세계 1' })
  expect(screen.getByRole('heading', { level: 2, name: '내가 만드는 세계관' })).toBeTruthy()
  expect(screen.getByRole('link', { name: /＋ 새 세계관 만들기/ }).getAttribute('href')).toBe('/worldstudio')
  expect(screen.getByRole('link', { name: '세계 1 관리하기' }).getAttribute('href')).toBe('/worldstudio/w1')
  expect(screen.getByRole('link', { name: '세계 2 관리하기' }).getAttribute('href')).toBe('/worldstudio/w2')
  expect(screen.getByRole('link', { name: '세계 1 관리하기' }).className).toBe('btn sm') // 작품 카드의 관리하기와 같은 보조 버튼
  expect(screen.getByText('설정 5개 · 버전 3')).toBeTruthy()
  expect(Array.from(container.querySelectorAll('img.cimg'), image => image.getAttribute('src'))).toEqual(['/default-work-cover.svg', '/default-work-cover.svg'])
  expect(screen.queryByRole('navigation', { name: '페이지' })).toBeNull()
})

it('shows the uploaded cover read with the owner session, the default when it is missing or unreadable, and nothing while it is being read', async () => {
  const read: Record<string, { url: string; error: string }> = {
    w2: { url: 'blob:world-cover', error: '' },
    w3: { url: '', error: '표지를 불러오지 못했어요.' },
  }
  cover.mockImplementation((_useCase, id) => read[id ?? ''] ?? { url: '', error: '' })
  api.list.mockResolvedValueOnce([world(1), { ...world(2), hasCover: true }, { ...world(3), hasCover: true }, { ...world(4), hasCover: true }])
  show()
  await screen.findByRole('heading', { level: 3, name: '세계 1' })
  expect(['세계 1', '세계 2', '세계 3', '세계 4'].map(coverOf)).toEqual(['/default-work-cover.svg', 'blob:world-cover', '/default-work-cover.svg', undefined])
  expect(cover).toHaveBeenCalledWith(api, 'w1', false, 0) // 표지가 없는 세계관은 읽지 않는다
  expect(cover).toHaveBeenCalledWith(api, 'w2', true, 0)
})

it('does not read covers when the world studio has no cover storage (demo)', async () => {
  api.supportsCover = false
  api.list.mockResolvedValueOnce([{ ...world(1), hasCover: true }])
  show()
  await screen.findByRole('heading', { level: 3, name: '세계 1' })
  expect(coverOf('세계 1')).toBe('/default-work-cover.svg')
  expect(cover).toHaveBeenCalledWith(api, 'w1', false, 0)
})

it('says so when there are no worlds yet and keeps the new-world link', async () => {
  api.list.mockResolvedValueOnce([])
  show()
  expect(await screen.findByText('아직 만든 세계관이 없어요.')).toBeTruthy()
  expect(screen.getByRole('link', { name: /＋ 새 세계관 만들기/ }).getAttribute('href')).toBe('/worldstudio')
})

it('shows loading first, then a retry next to the error that loads the list again', async () => {
  api.list.mockRejectedValueOnce(new Error('연결 실패')).mockResolvedValueOnce([world(1)])
  show()
  expect(screen.getByRole('status').textContent).toBe('세계관을 불러오고 있어요…')
  expect((await screen.findByRole('alert')).textContent).toBe('세계관을 불러오지 못했어요.')
  expect(screen.getByRole('link', { name: /＋ 새 세계관 만들기/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByRole('heading', { level: 3, name: '세계 1' })
  expect(api.list).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
})

it('ends with the same 새로 시작하기 section as the writing tab: three dashed cards and no header button', async () => {
  api.list.mockResolvedValueOnce([world(1)])
  const { container } = show()
  await screen.findByRole('heading', { level: 3, name: '세계 1' })
  expect(screen.getByRole('heading', { level: 2, name: '새로 시작하기' })).toBeTruthy()
  expect(Array.from(container.querySelectorAll('.newbox a.newc'), link => [link.querySelector('b')?.textContent, link.getAttribute('href')])).toEqual([
    ['＋ 새 세계관 만들기', '/worldstudio'],
    ['＋ 원고로 세계관 정리하기', '/worldstudio'],
    ['✎ 공개 세계관 둘러보기', '/worlds'],
  ])
  expect(screen.getByText('세계관을 만든 뒤 저장한 초안에서 AI 설정 후보를 받아요')).toBeTruthy()
  expect(screen.getAllByRole('link', { name: /새 세계관/ })).toHaveLength(1) // 헤더 오른쪽 '+ 새 세계관' 버튼은 이 섹션과 겹쳐 없앴다
})

it('pages ten worlds at a time with the shared pager', async () => {
  api.list.mockResolvedValueOnce(Array.from({ length: 12 }, (_, index) => world(index + 1)))
  show()
  await screen.findByRole('heading', { level: 3, name: '세계 1' })
  expect(names()).toHaveLength(10)
  fireEvent.click(within(screen.getByRole('navigation', { name: '페이지' })).getByRole('button', { name: '2' }))
  expect(names()).toEqual(['세계 11', '세계 12'])
})

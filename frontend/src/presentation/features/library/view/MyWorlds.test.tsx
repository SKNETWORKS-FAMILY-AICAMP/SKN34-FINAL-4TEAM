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
  expect(await screen.findByText('설정 7개')).toBeTruthy()
})

it('lists my worlds as cards that open the world studio, with a new-world link on top', async () => {
  api.list.mockResolvedValueOnce([world(1), world(2, 5)])
  const { container } = show()
  await screen.findByRole('heading', { level: 3, name: '세계 1' })
  expect(screen.getByRole('heading', { level: 2, name: '내가 만드는 세계관' })).toBeTruthy()
  expect(screen.getByRole('link', { name: /＋ 새 세계관 만들기/ }).getAttribute('href')).toBe('/worldstudio')
  expect(screen.queryByRole('link', { name: /관리하기/ })).toBeNull() // 같은 작업실로 가는 버튼은 없다: 이름 링크가 카드 전체를 덮는다
  // 이름도 같은 작업실 링크이고 ::after가 카드 전체를 덮는다(storyfork.css)
  expect(screen.getByRole('link', { name: '세계 1' }).getAttribute('href')).toBe('/worldstudio/w1')
  expect(screen.getByRole('link', { name: '세계 1' }).closest('article')?.className).toBe('li rowlink')
  expect(screen.getByText('설정 5개')).toBeTruthy() // 버전 N은 서재에서 고를 때 쓰지 않는 내부 값이라 카드에 없다
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

it('ends with a 새로 시작하기 section of two dashed cards: a new world and the public worlds', async () => {
  api.list.mockResolvedValueOnce([world(1)])
  const { container } = show()
  await screen.findByRole('heading', { level: 3, name: '세계 1' })
  expect(screen.getByRole('heading', { level: 2, name: '새로 시작하기' })).toBeTruthy()
  expect(Array.from(container.querySelectorAll('.newbox a.newc'), link => [link.querySelector('b')?.textContent, link.getAttribute('href')])).toEqual([
    ['＋ 새 세계관 만들기', '/worldstudio'],
    ['✎ 공개 세계관 둘러보기', '/worlds'],
  ])
})

it('puts a small primary + 새 세계관 button on the right of the heading row, going where the 새 세계관 만들기 card goes, and keeps it when the list failed', async () => {
  api.list.mockRejectedValueOnce(new Error('연결 실패'))
  show()
  await screen.findByRole('alert')
  const create = screen.getByRole('link', { name: '+ 새 세계관' })
  expect([create.getAttribute('href'), create.className]).toEqual(['/worldstudio', 'btn sm pri'])
  expect(create.getAttribute('href')).toBe(screen.getByRole('link', { name: /＋ 새 세계관 만들기/ }).getAttribute('href'))
  expect(create.previousElementSibling?.textContent).toBe('내가 만드는 세계관')
  expect(create.parentElement?.className).toBe('sec-h')
})

it('marks each world card public or private with the same chip as the work cards', async () => {
  api.list.mockResolvedValueOnce([world(1), { ...world(2), visibility: 'public' }])
  show()
  await screen.findByRole('heading', { level: 3, name: '세계 1' })
  const card = (name: string) => within(screen.getByRole('heading', { level: 3, name }).closest('article') as HTMLElement)
  expect(card('세계 1').getByText('비공개').className).toBe('chip') // 값이 없으면 비공개(옛 응답·데모)
  expect(card('세계 2').getByText('공개').className).toBe('chip ok')
  expect(card('세계 2').getByText('설정 2개')).toBeTruthy()
})

it('pages ten worlds at a time with the shared pager', async () => {
  api.list.mockResolvedValueOnce(Array.from({ length: 12 }, (_, index) => world(index + 1)))
  show()
  await screen.findByRole('heading', { level: 3, name: '세계 1' })
  expect(names()).toHaveLength(10)
  fireEvent.click(within(screen.getByRole('navigation', { name: '페이지' })).getByRole('button', { name: '2' }))
  expect(names()).toEqual(['세계 11', '세계 12'])
})

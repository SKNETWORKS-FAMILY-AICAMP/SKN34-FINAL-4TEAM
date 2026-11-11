// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { ServerWritingList } from './ServerWritingList'

const api = vi.hoisted(() => ({ list: vi.fn() }))
// 카드마다 서버 표지를 요청하는 공용 훅이다. 기본은 아직 불러오는 중({ url: '', error: '' })이고, mockReset이 이 구현으로 되돌린다.
const cover = vi.hoisted(() => vi.fn<(target: { workId: string }) => { url: string; error: string }>(() => ({ url: '', error: '' })))
vi.mock('../../../../app/appContainer', () => ({ appContainer: { resolve: () => api } }))
vi.mock('../../../shared/media/useMediaViewModel', () => ({ useStoredImage: cover }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.values(api).forEach(mock => mock.mockReset()); cover.mockReset() })

const original = { id: 'original', title: '원작', visibility: 'public', revision: 1, source: null }
const fork = { id: 'fork', title: '내 포크', summary: '소개', visibility: 'public', revision: 4,
  source: { workId: 'original', title: '원작', episode: 2, version: 7, direction: '다른 결말' } }
const originals = (count: number) => Array.from({ length: count }, (_, index) => ({ ...original, id: `o${index + 1}`, title: `원작 ${index + 1}` }))

/** 목록을 불러와 첫 카드(heading)가 보일 때까지 기다린다. */
const show = async (works: object[], heading = '내 포크') => {
  api.list.mockResolvedValueOnce(works)
  const view = render(<MemoryRouter><ServerWritingList /></MemoryRouter>)
  await screen.findByRole('heading', { name: heading })
  return view
}
const tab = (name: string) => screen.getByRole('tab', { name })
const titles = () => screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)
const pager = () => within(screen.getByRole('navigation', { name: '페이지' }))

it('filters the cards by tab with the counts, and moves between tabs with the arrow keys', async () => {
  await show([original, fork])
  expect(screen.getByRole('tablist')).toBeTruthy()
  expect(tab('전체 2').getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel', { name: '전체 2' })).toBeTruthy()
  expect(titles()).toEqual(['원작', '내 포크'])
  fireEvent.click(tab('포크 작품 1'))
  expect(tab('포크 작품 1').getAttribute('aria-selected')).toBe('true')
  expect(titles()).toEqual(['내 포크'])
  fireEvent.click(tab('전체 2'))

  fireEvent.keyDown(tab('전체 2'), { key: 'ArrowRight' })
  expect(tab('원작 1').getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(tab('원작 1'))
  expect(titles()).toEqual(['원작'])
  fireEvent.keyDown(tab('원작 1'), { key: 'ArrowRight' })
  expect(document.activeElement).toBe(tab('포크 작품 1'))
  fireEvent.keyDown(tab('포크 작품 1'), { key: 'ArrowRight' }) // 끝에서 처음으로
  expect(document.activeElement).toBe(tab('전체 2'))
  fireEvent.keyDown(tab('전체 2'), { key: 'ArrowLeft' }) // 처음에서 끝으로
  expect(document.activeElement).toBe(tab('포크 작품 1'))
  fireEvent.keyDown(tab('포크 작품 1'), { key: 'Home' })
  expect(document.activeElement).toBe(tab('전체 2'))
  fireEvent.keyDown(tab('전체 2'), { key: 'End' })
  expect(document.activeElement).toBe(tab('포크 작품 1'))
  expect(titles()).toEqual(['내 포크'])
  expect(tab('원작 1').getAttribute('tabindex')).toBe('-1') // 선택한 탭만 Tab 키로 닿는다
})

it.each([
  ['포크 작품 0', [original], '아직 만든 포크가 없어요.'],
  ['원작 0', [fork], '아직 만든 원작이 없어요.'],
] as const)('says so in an empty tab: %s', async (name, works, message) => {
  await show([...works], works[0].title)
  fireEvent.click(tab(name))
  expect(screen.getByText(message)).toBeTruthy()
  expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
})

it('shows ten works per page, marks the current page, and returns to page 1 when the tab changes', async () => {
  await show([...originals(12), fork], '원작 1')
  expect(titles()).toEqual(originals(10).map(work => work.title))
  expect(pager().getByRole('button', { name: '1' }).getAttribute('aria-current')).toBe('page')
  expect(pager().getByRole('button', { name: '이전' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(pager().getByRole('button', { name: '2' }))
  expect(titles()).toEqual(['원작 11', '원작 12', '내 포크'])
  expect(pager().getByRole('button', { name: '2' }).getAttribute('aria-current')).toBe('page')
  expect(pager().getByRole('button', { name: '다음' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(tab('원작 12'))
  expect(titles()).toEqual(originals(10).map(work => work.title))
  expect(pager().getByRole('button', { name: '1' }).getAttribute('aria-current')).toBe('page')
  fireEvent.click(tab('포크 작품 1'))
  expect(screen.queryByRole('navigation', { name: '페이지' })).toBeNull()
})

it('offers a retry next to the load error instead of a refresh button', async () => {
  api.list.mockRejectedValueOnce(new Error('접근 권한이 없어요')).mockResolvedValueOnce([original])
  render(<MemoryRouter><ServerWritingList /></MemoryRouter>)
  expect((await screen.findByRole('alert')).textContent).toBe('접근 권한이 없어요')
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByRole('heading', { name: '원작' })
  expect(api.list).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
})

it('is titled 집필 중인 작품 and has no refresh button, Fork toggle, or Fork management (that lives on the work management page)', async () => {
  const { container } = await show([original, fork])
  expect(screen.getByRole('heading', { level: 2, name: '집필 중인 작품' })).toBeTruthy()
  expect(container.querySelector('details')).toBeNull()
  expect(screen.queryByRole('button', { name: /새로고침|내 포크만 보기|포크 삭제|포크 공개 중단|기본 정보 저장/ })).toBeNull()
})

it('opens the work management page and the writing studio from separate links on every card', async () => {
  await show([original, fork])
  expect(screen.getByRole('link', { name: '내 포크 수정하기' }).getAttribute('href')).toBe('/content?work=fork')
  expect(screen.getByRole('link', { name: '내 포크 회차 작성하기' }).getAttribute('href')).toBe('/studio/fork')
  expect(screen.getByRole('link', { name: '원작 수정하기' }).getAttribute('href')).toBe('/content?work=original')
  expect(screen.getByRole('link', { name: '원작 회차 작성하기' }).getAttribute('href')).toBe('/studio/original')
})

it('shows the stored cover when there is one and the default cover otherwise, with a one-line status', async () => {
  // 원작은 표지가 없어(404) 요청이 실패로 끝나고, 포크는 저장된 표지가 있다.
  cover.mockImplementation(({ workId }) => workId === 'fork' ? { url: 'blob:cover', error: '' } : { url: '', error: '파일이 없거나 조회 권한이 없어요.' })
  const { container } = await show([original, fork])
  expect(Array.from(container.querySelectorAll('img.cimg'), image => image.getAttribute('src'))).toEqual(['/default-work-cover.svg', 'blob:cover'])
  expect(screen.getByText('공개 중 · Fork · 「원작」 2화에서')).toBeTruthy()
})

it('leaves the thumbnail empty until the cover request settles, so a work with a cover never flashes the default', async () => {
  const { container } = await show([original], '원작')
  expect(container.querySelector('img.cimg')).toBeNull()
})

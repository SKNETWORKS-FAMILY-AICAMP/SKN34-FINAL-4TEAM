// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { ServerWritingList } from './ServerWritingList'

const api = vi.hoisted(() => ({ list: vi.fn(), updateWork: vi.fn(), stopForkPublication: vi.fn(), deleteWork: vi.fn() }))
vi.mock('../../../../app/appContainer', () => ({ appContainer: { resolve: () => api } }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.values(api).forEach(mock => mock.mockReset()) })

const original = { id: 'original', title: '원작', visibility: 'public', revision: 1, source: null }
const fork = { id: 'fork', title: '내 포크', summary: '소개', visibility: 'public', revision: 4,
  source: { workId: 'original', title: '원작', episode: 2, version: 7, direction: '다른 결말' } }
const show = async (...works: object[]) => {
  api.list.mockResolvedValueOnce(works)
  render(<MemoryRouter><ServerWritingList /></MemoryRouter>)
  await screen.findByRole('heading', { name: '내 포크' })
  screen.getByText('포크 상세 및 관리').closest('details')!.open = true
}

it('shows the pinned basis and stops a Fork without deleting its library entry', async () => {
  api.list.mockResolvedValueOnce([original, fork]).mockResolvedValueOnce([original, { ...fork, visibility: 'private' }])
  api.stopForkPublication.mockResolvedValueOnce(undefined)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<MemoryRouter><ServerWritingList /></MemoryRouter>)
  await screen.findByRole('heading', { name: '내 포크' })
  const filter = screen.getByRole('button', { name: '내 포크만 보기' })
  fireEvent.click(filter)
  expect(filter.getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByRole('heading', { name: '원작' })).toBeNull()
  screen.getByText('포크 상세 및 관리').closest('details')!.open = true
  expect(screen.getByText('원작 「원작」 · 2화 기준 · 버전 7')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '포크 공개 중단' }))
  expect(confirm).toHaveBeenCalledWith('포크 작품의 공개를 중단할까요? 발행된 회차와 원고는 보존돼요. 대기 중인 예약 발행은 취소되고, 원작이 공개를 허용하지 않으면 다시 공개할 수 없어요.')
  expect(await screen.findByText('포크 공개를 중단했어요.')).toBeTruthy()
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  expect(await screen.findByRole('heading', { name: '내 포크' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '포크 공개 중단' })).toBeNull()
  expect(api.stopForkPublication).toHaveBeenCalledWith('fork', expect.any(AbortSignal))
})

it('keeps the cards while reloading after a save and then shows the saved values in the form', async () => {
  let finishReload!: (works: object[]) => void
  api.updateWork.mockResolvedValueOnce({})
  await show(original, fork)
  api.list.mockReturnValueOnce(new Promise(resolve => { finishReload = resolve }))
  fireEvent.change(screen.getByLabelText('포크 제목'), { target: { value: '  새 제목  ' } })
  fireEvent.click(screen.getByRole('button', { name: '기본 정보 저장' }))
  expect(await screen.findByText('포크 기본 정보를 저장했어요.')).toBeTruthy()
  expect(api.updateWork).toHaveBeenCalledWith('fork', '  새 제목  ', '소개', 4, expect.any(AbortSignal))
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('heading', { name: '내 포크' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '원작' })).toBeTruthy()
  finishReload([original, { ...fork, title: '새 제목', revision: 5 }])
  expect(await screen.findByRole('heading', { name: '새 제목' })).toBeTruthy()
  expect((screen.getByLabelText('포크 제목') as HTMLInputElement).value).toBe('새 제목')
})

it('asks about the irreversible consequences before deleting and keeps focus on the result', async () => {
  api.deleteWork.mockResolvedValueOnce(undefined)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await show(original, fork)
  api.list.mockResolvedValueOnce([original])
  fireEvent.click(screen.getByRole('button', { name: '포크 삭제' }))
  expect(confirm).toHaveBeenCalledWith('「내 포크」 포크를 삭제할까요? 서재와 공개 화면에서 숨겨지고 되돌릴 수 없어요. 같은 원작에서 포크를 다시 만들 수 없어요.')
  const result = await screen.findByText('포크를 삭제했어요.')
  await waitFor(() => expect(document.activeElement).toBe(result))
  await waitFor(() => expect(screen.queryByRole('heading', { name: '내 포크' })).toBeNull())
  expect(document.activeElement).toBe(result)
})

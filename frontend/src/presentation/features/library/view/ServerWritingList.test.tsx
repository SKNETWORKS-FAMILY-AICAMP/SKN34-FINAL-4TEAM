// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { ServerWritingList } from './ServerWritingList'

const api = vi.hoisted(() => ({ list: vi.fn(), stopForkPublication: vi.fn() }))
vi.mock('../../../../app/appContainer', () => ({ appContainer: { resolve: () => api } }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('shows the pinned basis and stops a Fork without deleting its library entry', async () => {
  const original = { id: 'original', title: '원작', visibility: 'public', source: null }
  const fork = { id: 'fork', title: '내 포크', visibility: 'public', revision: 4,
    source: { title: '원작', episode: 2, version: 7, deleted: true } }
  api.list.mockResolvedValueOnce([original, fork]).mockResolvedValueOnce([original, { ...fork, visibility: 'private' }])
  api.stopForkPublication.mockResolvedValueOnce(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<MemoryRouter><ServerWritingList /></MemoryRouter>)
  await screen.findByRole('heading', { name: '내 포크' })
  fireEvent.click(screen.getByRole('button', { name: '내 포크만 보기' }))
  expect(screen.queryByRole('heading', { name: '원작' })).toBeNull()
  const details = screen.getByText('포크 상세 및 관리').closest('details')!
  details.open = true
  expect(screen.getByText('삭제된 원작 「원작」 · 2화 기준 · 버전 7')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '포크 공개 중단' }))
  expect(await screen.findByText('포크 공개를 중단했어요.')).toBeTruthy()
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  expect(await screen.findByRole('heading', { name: '내 포크' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '포크 공개 중단' })).toBeNull()
  expect(api.stopForkPublication).toHaveBeenCalledWith('fork', expect.any(AbortSignal))
})

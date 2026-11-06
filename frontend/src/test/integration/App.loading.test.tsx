// @vitest-environment jsdom
import { use } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useNavigate } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import '../scrollToSpy'
import App from '../../App'
import { createAppStore } from '../../app/store'

const { loadStudio, loadAdmin } = vi.hoisted(() => ({ loadStudio: vi.fn(), loadAdmin: vi.fn() }))
let finish!: () => void
const ready = new Promise<void>((resolve) => { finish = resolve })
vi.mock('../../presentation/shared/session/useSessionRestore', () => ({ useSessionRestore: () => ({ restoring: false }) }))
vi.mock('../../presentation/features/studio/view/StudioPage', () => {
  loadStudio()
  return { StudioPage: () => { use(ready); return <main><h1>지연 집필실</h1></main> } }
})
vi.mock('../../presentation/features/admin/view/AdminPage', () => {
  loadAdmin()
  return { AdminPage: () => <h1>관리자 화면</h1> }
})
vi.mock('../../presentation/features/chat/view/ChatPages', () => { throw new Error('route chunk unavailable') })
afterEach(cleanup)

function OpenStudio() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/studio/owned-work')}>집필실로</button>
}

it('집필실은 요청할 때만 불러오고 로딩 중에도 공통 셸을 유지한다', async () => {
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={['/status']} useTransitions={false}><App /><OpenStudio /></MemoryRouter></Provider>)
  expect(screen.getByRole('heading', { name: 'STORYFORK' })).toBeTruthy()
  expect(loadStudio).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '집필실로' }))
  expect(await screen.findByText('화면을 불러오고 있어요.')).toHaveProperty('role', 'status')
  expect(document.getElementById('rbar')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '지연 집필실' })).toBeNull()
  await act(async () => { finish() })
  expect(await screen.findByRole('heading', { name: '지연 집필실' })).toBeTruthy()
  expect(screen.queryByText('화면을 불러오고 있어요.')).toBeNull()
  expect(loadStudio).toHaveBeenCalledTimes(1)
})

it('비관리자의 관리자 경로는 모듈을 불러오지 않고 기존 로그인 안내로 보낸다', async () => {
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={['/admin']} useTransitions={false}><App /></MemoryRouter></Provider>)
  expect(await screen.findByText('관리자 화면은 관리자 계정으로 로그인해야 볼 수 있어요.')).toBeTruthy()
  expect(loadAdmin).not.toHaveBeenCalled()
  expect(screen.queryByRole('heading', { name: '관리자 화면' })).toBeNull()
})

it('화면 로드 실패는 오류를 알리고 홈으로 이동하면 복구한다', async () => {
  const onCaughtError = vi.fn()
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={['/chat/owned-work']} useTransitions={false}><App /></MemoryRouter></Provider>, { onCaughtError })
  expect((await screen.findByRole('alert')).textContent).toContain('화면을 불러오지 못했어요.')
  expect(onCaughtError).toHaveBeenCalledWith(expect.objectContaining({ cause: new Error('route chunk unavailable') }), expect.anything())
  expect(document.getElementById('rbar')).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: '홈으로' }))
  expect(await screen.findByRole('heading', { name: 'STORYFORK' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

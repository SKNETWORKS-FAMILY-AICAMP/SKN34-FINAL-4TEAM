// @vitest-environment jsdom
import { useContext, useEffect, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { createMemoryRouter, RouterProvider, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../app/store'
import { SessionExpired } from '../../../domain/repositories/ProfileRepository'
import { WorldStudioLeaveProvider } from '../../features/worldstudio/viewmodel/WorldStudioLeaveProvider'
import { WorldStudioLeaveContext } from '../../features/worldstudio/viewmodel/worldStudioLeaveGuard'
import { useLogout } from './useLogout'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function show(dirty = true, logout: () => Promise<void> = vi.fn(async () => {})) {
  const store = createAppStore({ role: 'user', memberId: 'member' })
  function Editor() {
    const [text, setText] = useState(dirty ? '보존할 입력' : '')
    const guard = useContext(WorldStudioLeaveContext)
    const leave = useLogout({ logout })
    useEffect(() => {
      guard?.setDirty(!!text)
      return () => guard?.setDirty(false)
    }, [guard, text])
    return <><input aria-label="작성 내용" value={text} onChange={e => setText(e.target.value)} />
      <button onClick={() => { void leave() }}>로그아웃</button></>
  }
  const router = createMemoryRouter([{ path: '*', element: <WorldStudioLeaveProvider><Routes>
    <Route path="/worldstudio/test" element={<Editor />} />
    <Route path="*" element={<div>이동 완료</div>} />
  </Routes></WorldStudioLeaveProvider> }], { initialEntries: ['/worldstudio/test'] })
  render(<Provider store={store}><RouterProvider router={router} useTransitions={false} /></Provider>)
  return { router, store, logout }
}

it('keeps the URL, session and input on cancellation, then logs out with one approval', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { router, store, logout } = show()
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  expect(logout).not.toHaveBeenCalled()
  expect(store.getState().session.memberId).toBe('member')
  expect(router.state.location.pathname).toBe('/worldstudio/test')
  expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('보존할 입력')
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(logout).toHaveBeenCalledOnce()
  expect(store.getState().session.role).toBeNull()
  expect(confirm).toHaveBeenCalledTimes(2)
})

it('does not prompt for saved input and prevents concurrent logout calls', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  let finish!: () => void
  const logout = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const { router } = show(false, logout)
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  expect(logout).toHaveBeenCalledOnce()
  finish()
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(confirm).not.toHaveBeenCalled()
})

it('does not let the navigation confirmation retain an expired session after approval', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValue(false)
  const logout = vi.fn(async () => { throw new SessionExpired() })
  const { router, store } = show(true, logout)
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  expect(store.getState().session.role).toBeNull()
  expect(confirm).toHaveBeenCalledOnce()
})

it('keeps input and session after API failure and permits a guarded retry', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const logout = vi.fn(async () => {}).mockRejectedValueOnce(new Error('offline'))
  const { router, store } = show(true, logout)
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await waitFor(() => expect(logout).toHaveBeenCalledOnce())
  expect(router.state.location.pathname).toBe('/worldstudio/test')
  expect(store.getState().session.memberId).toBe('member')
  expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('보존할 입력')
  confirm.mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
  expect(logout).toHaveBeenCalledOnce()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(logout).toHaveBeenCalledTimes(2)
})

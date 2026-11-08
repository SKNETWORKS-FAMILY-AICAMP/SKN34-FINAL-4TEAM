// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import type { AppNotification } from '../../../../domain/entities/notification'
import { NotificationsPage } from './NotificationsPage'

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 }))) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const notice = (id: string): AppNotification => ({ id, kind: 'creation', summary: '알림 ' + id, targetType: null, targetId: null, createdAt: '2026-11-05T03:00:00Z', read: false })
/** 서버 목록은 Repository 메서드를 가로채 대신한다. 삭제 요청 결과는 `remove`로 정한다. */
function setup(ids: string[], remove: (id: string) => Promise<void> = async () => {}) {
  const repo = appContainer.resolve('notificationRepository')
  let items = ids.map(notice)
  vi.spyOn(repo, 'list').mockImplementation(async () => ({ items, nextCursor: null }))
  vi.spyOn(repo, 'unreadCount').mockImplementation(async () => items.length)
  vi.spyOn(repo, 'getPrefs').mockResolvedValue({ read: true, creator: true })
  const removed = vi.spyOn(repo, 'remove').mockImplementation(async (id) => { await remove(id); items = items.filter((n) => n.id !== id) })
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><NotificationsPage /></MemoryRouter></Provider>)
  return removed
}
const deleteButton = (id: string) => screen.findByRole('button', { name: `알림 삭제: 알림 ${id}` })
const openButton = (id: string) => screen.getByRole('button', { name: new RegExp(`^알림 ${id}\\b`) })

describe('알림함 (U42)', () => {
  it('h1 알림함 하나와 main#main을 가지고 탭 제목도 알림함이다', async () => {
    setup(['a'])
    await screen.findByText('알림 a')
    expect(document.title).toBe('알림함 · STORYFORK')
    const main = screen.getByRole('main')
    expect(main.id).toBe('main')
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['알림함'])
  })

  it.each([
    ['가운데 알림', 'b', 'c'],
    ['마지막 알림', 'c', 'b'],
  ])('%s를 삭제하면 다음(없으면 이전) 알림의 본문 버튼으로 초점이 간다', async (_name, removed, expected) => {
    setup(['a', 'b', 'c'])
    const button = await deleteButton(removed)
    button.focus()
    fireEvent.click(button)
    await waitFor(() => expect(screen.queryByText('알림 ' + removed)).toBeNull())
    expect(document.activeElement).toBe(openButton(expected))
  })

  it('마지막 남은 알림을 삭제하면 빈 목록 안내가 있는 목록 영역으로 초점이 간다', async () => {
    setup(['a'])
    const button = await deleteButton('a')
    button.focus()
    fireEvent.click(button)
    const empty = await screen.findByText('새 알림이 없어요.')
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.contains(empty)).toBe(true)
  })

  it('삭제에 실패하면 알림을 남기고 초점을 옮기지 않는다', async () => {
    const removed = setup(['a', 'b'], () => Promise.reject(new Error('down')))
    const button = await deleteButton('a')
    button.focus()
    fireEvent.click(button)
    await waitFor(() => expect(removed).toHaveBeenCalledTimes(1))
    await act(async () => {}) // 실패 처리와 이어지는 상태 갱신을 모두 반영한다
    expect(screen.getByText('알림 a')).toBeTruthy()
    expect(document.activeElement).toBe(button)
  })
})

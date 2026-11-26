// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import { getMobileNotice } from '../../../data/api/mobilePush'
import type { AppNotification } from '../../../domain/entities/notification'
import { sessionActions } from '../session/sessionSlice'
import { useMobileNoticeBridge } from './useMobileNoticeBridge'

vi.mock('../../../data/api/mobilePush', () => ({ getMobileNotice: vi.fn(), syncMobileDevice: vi.fn() }))
vi.mock('../../../app/appContainer', () => ({
  appContainer: { resolve: () => ({ list: async () => ({ items: [] }), markRead: async () => {} }) },
}))

function Probe() {
  useMobileNoticeBridge()
  return <output>{useLocation().pathname}</output>
}

const first = '7565d1dc-ae47-4fdf-af1c-cf278520a7e0'
const last = 'faa2ee53-f406-4f7d-923d-459d5eb99d27'
const item = (id: string): AppNotification => ({
  id, targetId: id, targetType: 'work', kind: 'reading', summary: '알림', createdAt: '2026-11-26T04:00:00Z', read: false,
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks() })

it('같은 계정에서 먼저 누른 알림의 늦은 응답이 최신 화면을 덮지 않는다', async () => {
  const store = createAppStore()
  const bridge = { postMessage: vi.fn() }
  vi.stubGlobal('ReactNativeWebView', bridge)
  store.dispatch(sessionActions.login({ id: first, email: 'reader@example.invalid', nickname: '독자', operator: false }))
  let finishFirst: (value: AppNotification) => void = () => {}
  vi.mocked(getMobileNotice).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
  vi.mocked(getMobileNotice).mockResolvedValueOnce(item(last))
  const page = render(<Provider store={store}><MemoryRouter><Probe /></MemoryRouter></Provider>)
  await waitFor(() => expect(bridge.postMessage).toHaveBeenCalled())
  act(() => {
    for (const id of [first, last]) window.dispatchEvent(new CustomEvent('storyfork:mobile', { detail: { type: 'storyfork.tap', id } }))
  })
  await waitFor(() => expect(page.getByRole('status').textContent).toBe('/work/' + last))
  await act(async () => { finishFirst(item(first)) })
  expect(page.getByRole('status').textContent).toBe('/work/' + last)
})

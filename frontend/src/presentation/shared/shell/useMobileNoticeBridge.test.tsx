// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import type { AppNotification } from '../../../domain/entities/notification'
import type { ShellUseCase } from '../../../domain/usecases/ShellUseCase'
import { sessionActions } from '../session/sessionSlice'
import { useMobileNoticeBridge } from './useMobileNoticeBridge'

function Probe({ shell }: { shell: ShellUseCase }) {
  useMobileNoticeBridge(shell)
  return <output>{useLocation().pathname}</output>
}

const first = '7565d1dc-ae47-4fdf-af1c-cf278520a7e0'
const last = 'faa2ee53-f406-4f7d-923d-459d5eb99d27'
const installation = '7da43875-6da5-4f2a-9f11-a7bb40adcd07'
const item = (id: string): AppNotification => ({
  id, targetId: id, targetType: 'work', kind: 'reading', summary: '알림', createdAt: '2026-11-26T04:00:00Z', read: false,
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** 앱 안(브리지 있음)에서 로그인한 상태로 그린다. 알림 조회·읽음·기기 등록은 가짜 UseCase로 주입한다. */
function setup() {
  const store = createAppStore()
  const bridge = { postMessage: vi.fn() }
  vi.stubGlobal('ReactNativeWebView', bridge)
  store.dispatch(sessionActions.login({ id: first, email: 'reader@example.invalid', nickname: '독자', operator: false }))
  const shell = { getNotification: vi.fn<ShellUseCase['getNotification']>(), markRead: vi.fn(async () => {}), syncPushDevice: vi.fn(async () => {}) }
  const page = render(<Provider store={store}><MemoryRouter><Probe shell={shell as unknown as ShellUseCase} /></MemoryRouter></Provider>)
  const send = (detail: object) => act(() => { window.dispatchEvent(new CustomEvent('storyfork:mobile', { detail })) })
  return { bridge, shell, page, send }
}

it('같은 계정에서 먼저 누른 알림의 늦은 응답이 최신 화면을 덮지 않는다', async () => {
  const { bridge, shell, page, send } = setup()
  let finishFirst: (value: AppNotification) => void = () => {}
  shell.getNotification.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
  shell.getNotification.mockResolvedValueOnce(item(last))
  await waitFor(() => expect(bridge.postMessage).toHaveBeenCalled())
  for (const id of [first, last]) send({ type: 'storyfork.tap', id })
  await waitFor(() => expect(page.getByRole('status').textContent).toBe('/work/' + last))
  await act(async () => { finishFirst(item(first)) })
  expect(page.getByRole('status').textContent).toBe('/work/' + last)
  expect(shell.markRead.mock.calls).toEqual([[last]])
})

it('앱이 보낸 기기 토큰은 ShellUseCase로 등록한다', async () => {
  const { bridge, shell, send } = setup()
  await waitFor(() => expect(bridge.postMessage).toHaveBeenCalled())
  const device = { type: 'storyfork.device', installationId: installation, token: 'fcm-token' }
  send(device)
  await waitFor(() => expect(shell.syncPushDevice).toHaveBeenCalledWith(device, expect.any(AbortSignal)))
})

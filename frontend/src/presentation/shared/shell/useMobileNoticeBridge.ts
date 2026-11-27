import { useContext, useEffect, useEffectEvent } from 'react'
import { useNavigate } from 'react-router'
import { z } from 'zod'

import { appContainer } from '../../../app/appContainer'
import { useAppSelector } from '../../../app/store'
import { readyMessage } from '../../../domain/entities/nativeBridge'
import { noticeTarget } from '../../../domain/entities/notification'
import type { ShellUseCase } from '../../../domain/usecases/ShellUseCase'
import { RestoreContext } from '../session/restoreContext'

type MobileWindow = Window & { ReactNativeWebView?: { postMessage(value: string): void } }
const fromMobile = z.discriminatedUnion('type', [
  z.object({ type: z.literal('storyfork.tap'), id: z.string().uuid() }),
  z.object({ type: z.literal('storyfork.device'), installationId: z.string().uuid(), token: z.string().min(1).max(4096).nullable() }),
])

/** 설치 앱의 WebView만 기존 인증·SSE·알림 이동을 네이티브 알림과 연결한다. */
export function useMobileNoticeBridge(shellUseCase: ShellUseCase = appContainer.resolve('shellUseCase')) {
  const restoring = useContext(RestoreContext)
  const navigate = useNavigate()
  const open = useEffectEvent((target: string) => navigate(target))
  const account = useAppSelector(s => s.session.memberId)

  useEffect(() => {
    const bridge = (window as MobileWindow).ReactNativeWebView
    if (!bridge || restoring) return
    const controller = new AbortController()
    const signal = controller.signal
    let registration: Promise<void> = Promise.resolve()
    let latestTap = 0

    function receive(event: Event) {
      if (!(event instanceof CustomEvent) || !account) return
      const message = fromMobile.safeParse(event.detail)
      if (!message.success) return
      if (message.data.type === 'storyfork.device') {
        const device = message.data
        // 갱신 두 건이 차례로 저장되도록 하고, 로그아웃 시 대기 요청은 중단한다.
        registration = registration.then(async () => {
          if (!signal.aborted) await shellUseCase.syncPushDevice(device, signal)
        }).catch(() => {
          if (!signal.aborted) console.warn('Android 알림 등록을 저장하지 못했어요.')
        })
      } else {
        const id = message.data.id
        const tap = ++latestTap
        void shellUseCase.getNotification(id, signal).then(notice => {
          if (signal.aborted || tap !== latestTap) return
          void shellUseCase.markRead(id).catch(() => {})
          open(noticeTarget(notice) ?? '/notifications')
        }).catch(() => { if (!signal.aborted && tap === latestTap) open('/notifications') })
      }
    }

    window.addEventListener('storyfork:mobile', receive)
    bridge.postMessage(JSON.stringify(readyMessage(account)))
    return () => {
      controller.abort()
      window.removeEventListener('storyfork:mobile', receive)
    }
  }, [account, restoring, shellUseCase])
}

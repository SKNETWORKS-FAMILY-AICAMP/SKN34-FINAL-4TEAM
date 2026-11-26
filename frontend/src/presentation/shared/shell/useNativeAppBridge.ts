import { useEffect, useRef } from 'react'

import { appContainer } from '../../../app/appContainer'
import { useAppSelector } from '../../../app/store'
import { logoutMessage, notificationsMessage } from '../../../domain/entities/nativeBridge'
import type { ShellUseCase } from '../../../domain/usecases/ShellUseCase'

type NativeBridge = { postMessage(data: string): void }

declare global {
  interface Window {
    /** 모바일 앱(react-native-webview)이 주입하는 브리지. 브라우저에는 없다. */
    ReactNativeWebView?: NativeBridge
  }
}

const nativeBridge = () => window.ReactNativeWebView

/**
 * 모바일 앱(WebView, #943)에서만: 알림 변경 신호(SSE)마다 알림 목록 첫 쪽을 읽어 앱에 보내고, 로그아웃·계정 전환 때 앱이 알림 기준선을 비우게 한다.
 * 앱은 이 목록으로 새 알림을 로컬 알림으로 띄운다(메시지 형식: domain/entities/nativeBridge.ts). 새 API는 없고 목록은 ShellUseCase.listNotifications 한 쪽이다.
 * 브라우저(앱 밖)에는 window.ReactNativeWebView가 없어 목록을 읽지도 메시지를 보내지도 않는다. 읽기 실패는 다음 신호까지 기다린다.
 */
export function useNativeAppBridge(shellUseCase: ShellUseCase = appContainer.resolve('shellUseCase'), getBridge: () => NativeBridge | undefined = nativeBridge) {
  const memberId = useAppSelector((s) => (s.session.role ? s.session.memberId : null))
  const noticeVersion = useAppSelector((s) => s.session.noticeVersion)

  // 로그인한 회원이 없어지거나(로그아웃) 바뀌면(계정 전환) 앱이 알림 기준선을 비우게 알린다. 효과가 다시 돌 뿐 회원이 그대로면 보내지 않는다.
  const lastMember = useRef<string | null>(null)
  useEffect(() => {
    const previous = lastMember.current
    lastMember.current = memberId
    if (previous && previous !== memberId) getBridge()?.postMessage(JSON.stringify(logoutMessage))
  }, [memberId, getBridge])

  useEffect(() => {
    const bridge = getBridge()
    if (!bridge || !memberId) return
    const request = new AbortController()
    shellUseCase.listNotifications(null, request.signal).then(
      (page) => { if (!request.signal.aborted) bridge.postMessage(JSON.stringify(notificationsMessage(memberId, page.items))) },
      () => {},
    )
    return () => request.abort()
  }, [memberId, noticeVersion, shellUseCase, getBridge])
}

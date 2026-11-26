import { useEffect, useRef, useSyncExternalStore } from 'react'

import { useAppDispatch, useAppSelector } from '../../../app/store'
import { appContainer } from '../../../app/appContainer'
import type { OpenNotificationStream } from '../../../domain/entities/notificationStream'
import { sessionActions } from '../session/sessionSlice'

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}
const isVisible = () => document.visibilityState !== 'hidden'

/**
 * 로그인한 동안 알림 변경 신호(SSE)를 구독합니다. 신호를 받으면 noticeVersion을 올려 GNB 배지·알림함이 다시 조회하게 하고,
 * 로그아웃·계정 전환 때는 연결을 닫은 뒤 한 번 더 올려 이전 사용자의 배지가 남지 않게 합니다.
 * 탭이 숨겨진 동안에는 연결을 닫습니다(#738). 브라우저는 한 호스트에 HTTP/1.1 연결을 6개까지만 열어, 탭마다 열린 SSE가 보이는 탭의 요청을 막을 수 있습니다.
 * 다시 보이면 새로 연결하고, 재연결 성공 여부와 상관없이 숨긴 동안 온 알림을 한 번 다시 조회합니다.
 */
export function useNotificationStream(openNotificationStream: OpenNotificationStream = appContainer.resolve('openNotificationStream')) {
  const dispatch = useAppDispatch()
  const account = useAppSelector((s) => (s.session.role ? s.session.user.email : null))
  const visible = useSyncExternalStore(subscribeVisibility, isVisible)
  useEffect(() => {
    if (!account || !visible) return
    const close = openNotificationStream({
      onSignal: () => dispatch(sessionActions.noticeSignal()),
      onState: (state) => dispatch(sessionActions.noticeStreamState(state)),
    })
    return () => {
      close()
      dispatch(sessionActions.noticeStreamState('off'))
    }
  }, [account, visible, dispatch, openNotificationStream])
  // 숨겼다가 다시 보이면 재연결 성공과 상관없이 숨긴 동안 온 알림을 한 번 다시 조회한다.
  const wasVisible = useRef(visible)
  useEffect(() => {
    if (account && visible && !wasVisible.current) dispatch(sessionActions.noticeSignal())
    wasVisible.current = visible
  }, [account, visible, dispatch])
  // 이전 사용자의 배지 정리는 탭 숨김이 아니라 로그아웃·계정 전환에만 건다.
  useEffect(() => {
    if (!account) return
    return () => { dispatch(sessionActions.noticeSignal()) }
  }, [account, dispatch])
}

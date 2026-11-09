import { useEffect } from 'react'

import { useAppDispatch, useAppSelector } from '../../../app/store'
import { appContainer } from '../../../app/appContainer'
import type { OpenNotificationStream } from '../../../domain/entities/notificationStream'
import { sessionActions } from '../session/sessionSlice'

/**
 * 로그인한 동안 알림 변경 신호(SSE)를 구독합니다. 신호를 받으면 noticeVersion을 올려 GNB 배지·알림함이 다시 조회하게 하고,
 * 로그아웃·계정 전환 때는 연결을 닫은 뒤 한 번 더 올려 이전 사용자의 배지가 남지 않게 합니다.
 */
export function useNotificationStream(openNotificationStream: OpenNotificationStream = appContainer.resolve('openNotificationStream')) {
  const dispatch = useAppDispatch()
  const account = useAppSelector((s) => (s.session.role ? s.session.user.email : null))
  useEffect(() => {
    if (!account) return
    const close = openNotificationStream({
      onSignal: () => dispatch(sessionActions.noticeSignal()),
      onState: (state) => dispatch(sessionActions.noticeStreamState(state)),
    })
    return () => {
      close()
      dispatch(sessionActions.noticeStreamState('off'))
      dispatch(sessionActions.noticeSignal())
    }
  }, [account, dispatch, openNotificationStream])
}

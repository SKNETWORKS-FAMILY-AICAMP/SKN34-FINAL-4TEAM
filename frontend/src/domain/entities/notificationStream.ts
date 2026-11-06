/** off: 비로그인·만료, connecting: 연결 중, live: 연결됨, offline: 자동 재연결 중 */
export type StreamState = 'off' | 'connecting' | 'live' | 'offline'

export type NotificationStreamOptions = {
  /** 연결·재연결 또는 변경 신호입니다. 읽음 처리는 하지 않습니다. */
  onSignal: () => void
  onState: (state: StreamState) => void
}

export type OpenNotificationStream = (options: NotificationStreamOptions) => () => void

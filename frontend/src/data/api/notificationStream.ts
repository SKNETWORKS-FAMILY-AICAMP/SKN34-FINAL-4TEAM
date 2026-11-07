import { SessionExpired } from '../../domain/repositories/ProfileRepository'
import { authVersion, protectedRequest } from './auth'

import type { NotificationStreamOptions } from '../../domain/entities/notificationStream'

export type StreamOptions = NotificationStreamOptions & {
  fetcher?: typeof fetch
  /** 이 시간 동안 아무 바이트(ping 포함)도 오지 않으면 끊고 다시 연결합니다. 서버는 20초마다 ping을 보냅니다. */
  idleMs?: number
  /** 테스트용: 재연결 대기 시간(ms) 계산 */
  backoff?: (attempt: number) => number
}

const PATH = '/api/v1/me/notifications/stream'
const defaultBackoff = (attempt: number) => Math.min(1000 * 2 ** attempt, 30000) + Math.floor(Math.random() * 500)

/**
 * 인증된 SSE 변경 신호 구독. 브라우저 EventSource는 Authorization 헤더를 보낼 수 없어 fetch 스트림으로 읽고,
 * 토큰은 URL에 넣지 않습니다. 끊기면 지수 백오프로 다시 연결하고, 로그인 세션이 바뀌거나(로그아웃·계정 전환) 닫으면 멈춥니다.
 * 반환 함수를 호출하면 연결을 닫습니다.
 */
export function openNotificationStream(options: StreamOptions): () => void {
  const stop = new AbortController()
  void run(options, stop.signal)
  return () => stop.abort()
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

async function run(options: StreamOptions, stop: AbortSignal) {
  const version = authVersion()
  const idleMs = options.idleMs ?? 60000
  const backoff = options.backoff ?? defaultBackoff
  let failures = 0
  while (!stop.aborted && authVersion() === version) {
    options.onState('connecting')
    const connection = new AbortController()
    const closeConnection = () => connection.abort()
    stop.addEventListener('abort', closeConnection, { once: true })
    let idle: ReturnType<typeof setTimeout> | undefined
    const watch = () => { clearTimeout(idle); idle = setTimeout(closeConnection, idleMs) }
    try {
      watch()
      const response = await protectedRequest(PATH, { signal: connection.signal, headers: { Accept: 'text/event-stream' } }, version, false, { fetcher: options.fetcher })
      if (!response.body) throw new Error('알림 스트림을 열 수 없어요.')
      const reader = response.body.getReader()
      connection.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}), { once: true })
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        watch()
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
          const frame = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const name = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim()
          if (name === 'ready') { failures = 0; options.onState('live'); options.onSignal() }
          else if (name === 'changed') options.onSignal()
        }
      }
      // 서버가 연결 수명(10분)에 맞춰 정상 종료한 경우: 새 토큰으로 바로 다시 연결합니다.
      if (!stop.aborted) await wait(300, stop)
    } catch (error) {
      if (stop.aborted || authVersion() !== version) break
      if (error instanceof SessionExpired) { options.onState('off'); break }
      options.onState('offline')
      await wait(backoff(failures++), stop)
    } finally {
      clearTimeout(idle)
      stop.removeEventListener('abort', closeConnection)
    }
  }
}

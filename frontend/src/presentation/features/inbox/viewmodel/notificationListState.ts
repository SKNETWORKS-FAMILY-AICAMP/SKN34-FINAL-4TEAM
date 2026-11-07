import type { AppNotification, NotificationPage } from '../../../../domain/entities/notification'
import { mergeFirstPage } from './mergeFirstPage.ts'

export type NotificationListState = {
  items: AppNotification[]
  nextCursor: string | null
  appliedRefreshSeq: number
  readUpTo: string | null
}

/** 요청 시작이 아니라 실제 반영한 성공 순번을 기준으로 늦은 응답을 거릅니다. */
export function applyNotificationRefresh(current: NotificationListState, page: NotificationPage, seq: number): NotificationListState {
  if (seq <= current.appliedRefreshSeq) return current
  const merged = mergeFirstPage(current, page)
  return { ...current, ...merged, items: readNotificationsThrough(merged.items, current.readUpTo), appliedRefreshSeq: seq }
}

/** 성공한 서버의 createdAt <= upTo 경계는 중첩 요청의 응답 순서와 무관하게 유지합니다. */
export function completeMarkAllRead(current: NotificationListState, upTo: string): NotificationListState {
  const readUpTo = current.readUpTo !== null && atOrBefore(upTo, current.readUpTo) ? current.readUpTo : upTo
  return { ...current, readUpTo, items: readNotificationsThrough(current.items, readUpTo) }
}

/** 현재 목록·SSE·추가 조회 모두 같은 성공 경계를 적용합니다. */
export function readNotificationsThrough(items: AppNotification[], upTo: string | null): AppNotification[] {
  if (upTo === null) return items
  return items.map((n) => (!n.read && atOrBefore(n.createdAt, upTo) ? { ...n, read: true } : n))
}

function atOrBefore(at: string, upTo: string): boolean {
  const milliseconds = Date.parse(at) - Date.parse(upTo)
  if (milliseconds !== 0) return milliseconds < 0
  // Date는 밀리초까지만 보존합니다. 같은 밀리초에서는 Instant의 나노초까지 비교합니다(오프셋도 허용).
  const fraction = (iso: string) => (iso.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0')
  return fraction(at) <= fraction(upTo)
}

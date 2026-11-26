import type { AppNotification } from './notification'

/**
 * 웹 → 모바일 앱(WebView, #943) 메시지. 앱(mobile/src/bridge.ts)이 같은 형식을 검증하고, 알림 계약 문서(docs/notification-event-contract.md)에도 적혀 있다.
 * 형식을 바꾸면 세 곳을 함께 고친다. 알림 항목은 summary만 싣고 원고 본문 같은 값은 싣지 않는다.
 */
export type NativeNotification = Pick<AppNotification, 'id' | 'kind' | 'targetType' | 'targetId' | 'summary' | 'read' | 'createdAt'>
export type NativeAppMessage =
  | { type: 'storyfork.notifications'; userId: string; items: NativeNotification[] }
  | { type: 'storyfork.logout' }

/** 알림 목록 첫 쪽을 읽은 직후 앱에 알린다. 앱은 첫 목록을 기준선으로 삼고 그 뒤 새로 생긴 읽지 않은 알림만 로컬 알림으로 띄운다. */
export const notificationsMessage = (userId: string, items: AppNotification[]): NativeAppMessage & { type: 'storyfork.notifications' } => ({
  type: 'storyfork.notifications',
  userId,
  items: items.map(({ id, kind, targetType, targetId, summary, read, createdAt }) => ({ id, kind, targetType, targetId, summary, read, createdAt })),
})

/** 로그아웃·계정 전환 때 앱이 알림 기준선을 비우게 한다. */
export const logoutMessage: NativeAppMessage = { type: 'storyfork.logout' }

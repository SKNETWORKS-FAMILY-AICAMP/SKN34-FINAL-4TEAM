import type { AppNotification, NotificationPage } from '../../../../domain/entities/notification'

/**
 * SSE 신호 뒤 다시 받은 첫 페이지를 화면의 기존 목록과 합칩니다. 시각 문자열을 비교하지 않고 서버 정렬 순서와 id만 씁니다.
 * - 첫 페이지가 목록 전체를 덮으면(nextCursor 없음) 그대로 바꿉니다.
 * - 기존 목록과 겹치면, 겹친 마지막 알림 뒤의 이미 불러온 알림을 이어 붙입니다(다른 곳에서 지운 알림은 앞부분에서 사라집니다).
 * - 겹치지 않으면(연결이 끊긴 사이 한 페이지 넘게 도착) 사이 알림을 알 수 없으므로 새 첫 페이지부터 다시 시작합니다.
 */
export function mergeFirstPage(current: { items: AppNotification[]; nextCursor: string | null }, page: NotificationPage) {
  if (!page.nextCursor) return { items: page.items, nextCursor: null }
  const inPage = new Set(page.items.map((p) => p.id))
  let lastShared = -1
  current.items.forEach((o, i) => { if (inPage.has(o.id)) lastShared = i })
  if (lastShared < 0) return { items: page.items, nextCursor: page.nextCursor }
  return { items: [...page.items, ...current.items.slice(lastShared + 1)], nextCursor: current.nextCursor }
}

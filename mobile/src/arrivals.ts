import type { AppNotification } from './notification.ts'

const key = (n: AppNotification) => `${n.id}@${n.createdAt}`

/**
 * 로컬 알림을 띄울 알림을 고른다. seen은 이미 본 알림 키(id@createdAt)이고, null이면 첫 조회라 기준선만 만들고 알리지 않는다.
 * 시각까지 키에 넣는 이유: ai-tool 알림은 같은 대상의 읽지 않은 알림이 있으면 새 알림 없이 시각만 올라간다(알림 사건 계약).
 * fresh는 오래된 순이라 OS 알림 목록에서 가장 새 알림이 위에 쌓인다.
 */
export function arrivals(items: AppNotification[], seen: ReadonlySet<string> | null): { fresh: AppNotification[]; seen: Set<string> } {
  const next = new Set(seen)
  for (const n of items) next.add(key(n))
  return { fresh: seen ? items.filter((n) => !n.read && !seen.has(key(n))).reverse() : [], seen: next }
}

import { z } from 'zod'

import { arrivals } from './arrivals.ts'
import { notice, type AppNotification } from './notification.ts'

/**
 * 웹(WebView) → 앱 메시지. 웹 frontend/src/domain/entities/nativeBridge.ts가 보내는 형식과 같고, 알림 계약 문서(docs/notification-event-contract.md)에도 적혀 있다.
 * 웹이 알림 목록 첫 쪽을 읽을 때마다 storyfork.notifications를, 로그아웃·계정 전환 때 storyfork.logout을 보낸다. 알림 항목은 summary만 싣고 원고 본문은 없다.
 */
const message = z.discriminatedUnion('type', [
  z.object({ type: z.literal('storyfork.ready'), account: z.string().min(1).nullable() }),
  z.object({ type: z.literal('storyfork.notifications'), userId: z.string().min(1), items: z.array(notice) }),
  z.object({ type: z.literal('storyfork.logout') }),
])

/** userId: 마지막으로 목록을 보낸 회원, seen: 그 회원의 이미 본 알림(arrivals의 기준선). 둘 다 앱을 다시 켜면 비워진다. */
export type BridgeState = { userId: string | null; seen: ReadonlySet<string> | null }
export const initialBridgeState: BridgeState = { userId: null, seen: null }

/**
 * WebView가 보낸 문자열을 검증해 기준선에 반영하고 새로 로컬 알림을 띄울 알림을 고른다.
 * 첫 목록·계정이 바뀐 뒤 첫 목록·로그아웃 뒤 첫 목록은 기준선만 만든다(기존 알림을 한꺼번에 띄우지 않는다). 형식이 다른 메시지는 무시한다.
 */
export function receive(state: BridgeState, raw: string): { state: BridgeState; fresh: AppNotification[]; accountReady?: true } {
  let data: unknown
  try { data = JSON.parse(raw) } catch { return { state, fresh: [] } }
  const parsed = message.safeParse(data)
  if (!parsed.success) return { state, fresh: [] }
  if (parsed.data.type === 'storyfork.ready') {
    const userId = parsed.data.account
    return { state: userId === state.userId ? state : { userId, seen: null }, fresh: [], accountReady: true }
  }
  if (parsed.data.type === 'storyfork.logout') return { state: initialBridgeState, fresh: [] }
  const { userId, items } = parsed.data
  const { fresh, seen } = arrivals(items, userId === state.userId ? state.seen : null)
  return { state: { userId, seen }, fresh }
}

export type MobileNotice = { id: string; summary: string; createdAt: string; read: boolean }
type WebMessage =
  | { type: 'storyfork.ready'; account: string | null }
  | { type: 'storyfork.notices'; items: MobileNotice[] }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const noticeId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value)

export function shouldRequestNotificationPermission(permission: { granted: boolean; canAskAgain: boolean }, requested: boolean) {
  return !requested && !permission.granted && permission.canAskAgain
}

export function trustedPage(origin: string, address: string) {
  try { return new URL(address).origin === origin } catch { return false }
}

export function parseWebMessage(raw: string): WebMessage | null {
  try {
    const value = JSON.parse(raw)
    if (value?.type === 'storyfork.ready' && (value.account === null || noticeId(value.account))) return value
    if (value?.type === 'storyfork.notices' && Array.isArray(value.items) && value.items.length <= 100 &&
      value.items.every((item: MobileNotice) => item && noticeId(item.id) && typeof item.summary === 'string' &&
        item.summary.length <= 300 && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) &&
        typeof item.read === 'boolean')) return value
  } catch { /* 거부한 브리지 메시지는 앱 상태를 바꾸지 않는다. */ }
  return null
}

export function clearInbox() {
  return { ready: false, latest: '', ids: new Set<string>() }
}

// Core Instant는 UTC이며 나노초 자리수까지 정렬할 수 있게 소수부를 채운다.
const stamp = (value: string) => value.replace(/(?:\.(\d+))?Z$/, (_, fraction: string | undefined) => '.' + (fraction ?? '').padEnd(9, '0') + 'Z')

export function newNotices(state: ReturnType<typeof clearInbox>, items: MobileNotice[]) {
  const fresh = state.ready ? items.filter(item => {
    const time = stamp(item.createdAt)
    return !item.read && (time > state.latest || (time === state.latest && !state.ids.has(item.id)))
  }) : []
  state.ready = true
  for (const item of items) {
    const time = stamp(item.createdAt)
    if (time > state.latest) { state.latest = time; state.ids.clear() }
    if (time === state.latest) state.ids.add(item.id)
  }
  return fresh
}

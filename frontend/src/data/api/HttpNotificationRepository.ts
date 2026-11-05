import { z } from 'zod'

import type { NotificationPage } from '../../domain/entities/notification'
import type { NotificationPrefs, NotificationRepository } from '../../domain/repositories/NotificationRepository'
import { authVersion, protectedRequest } from './auth'
import { csrf } from './csrf'

const kind = z.enum(['reading', 'creation', 'result', 'credit', 'rights-security'])
const notice = z.object({
  id: z.string().min(1), kind, summary: z.string(), targetType: z.string().nullable(), targetId: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }), read: z.boolean(),
})
const pageSchema = z.object({ items: z.array(notice), nextCursor: z.string().nullable() })
const prefsSchema = z.object({ items: z.array(z.object({ kind: z.string(), enabled: z.boolean(), mutable: z.boolean() })) })
const base = '/api/v1/me/notifications'

/** 인증된 Core 알림 API(/api/v1/me/notifications·notification-preferences) 구현. 데모 데이터는 섞지 않습니다. */
export class HttpNotificationRepository implements NotificationRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  private async request(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; okStatuses?: number[] } = {}) {
    const version = authVersion()
    const method = init.method ?? 'GET'
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
    const headers: Record<string, string> = {}
    if (method !== 'GET') headers['X-CSRF-TOKEN'] = await csrf(signal)
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await protectedRequest(path, { method, signal, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }, version, false, { fetcher: this.fetcher, allowHttpError: true })
    if (!response.ok && !init.okStatuses?.includes(response.status)) throw new Error('알림 요청을 처리하지 못했어요.')
    return response
  }

  async list(cursor?: string | null, signal?: AbortSignal): Promise<NotificationPage> {
    const query = new URLSearchParams({ limit: '20' })
    if (cursor) query.set('cursor', cursor)
    const page = pageSchema.parse(await (await this.request(`${base}?${query}`, { signal })).json())
    return page
  }

  async unreadCount(signal?: AbortSignal) {
    return z.object({ count: z.number().int().nonnegative() }).parse(await (await this.request(`${base}/unread-count`, { signal })).json()).count
  }

  /** 이미 없어졌거나(404) 이미 읽은 알림은 같은 결과(읽음)이므로 성공으로 봅니다. */
  async markRead(id: string) { await this.request(`${base}/${encodeURIComponent(id)}/read`, { method: 'PATCH', okStatuses: [404] }) }
  async markAllRead(upTo: string) { await this.request(`${base}/read-all`, { method: 'POST', body: { upTo } }) }
  async remove(id: string) { await this.request(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE', okStatuses: [404] }) }

  async getPrefs(signal?: AbortSignal) { return toPrefs(prefsSchema.parse(await (await this.request('/api/v1/me/notification-preferences', { signal })).json())) }
  async savePrefs(prefs: NotificationPrefs) {
    const body = { items: [{ kind: 'reading', enabled: prefs.read }, { kind: 'creation', enabled: prefs.creator }] }
    return toPrefs(prefsSchema.parse(await (await this.request('/api/v1/me/notification-preferences', { method: 'PUT', body })).json()))
  }
}

function toPrefs(response: z.infer<typeof prefsSchema>): NotificationPrefs {
  const on = (code: string) => response.items.find((i) => i.kind === code)?.enabled ?? true
  return { read: on('reading'), creator: on('creation') }
}

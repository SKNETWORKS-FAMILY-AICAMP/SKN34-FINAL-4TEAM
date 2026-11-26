import { expect, it } from 'vitest'

import { logoutMessage, notificationsMessage } from '../entities/nativeBridge'
import type { AppNotification } from '../entities/notification'

const n = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1', kind: 'creation', summary: '새 회차가 올라왔어요', targetType: 'work', targetId: 'w1', createdAt: '2026-11-26T01:00:00Z', read: false, ...over,
})

it('알림 목록 메시지는 회원 id와 알림 항목(앱이 쓰는 필드)을 싣는다', () => {
  expect(notificationsMessage('u1', [n(), n({ id: 'n2', kind: 'credit', targetType: 'credit-expiry', targetId: '2026-12-01', read: true })])).toEqual({
    type: 'storyfork.notifications',
    userId: 'u1',
    items: [
      { id: 'n1', kind: 'creation', targetType: 'work', targetId: 'w1', summary: '새 회차가 올라왔어요', read: false, createdAt: '2026-11-26T01:00:00Z' },
      { id: 'n2', kind: 'credit', targetType: 'credit-expiry', targetId: '2026-12-01', summary: '새 회차가 올라왔어요', read: true, createdAt: '2026-11-26T01:00:00Z' },
    ],
  })
})

it('정해진 필드 밖의 값(예: 원고 본문)은 싣지 않는다', () => {
  const { items } = notificationsMessage('u1', [{ ...n(), body: '비공개 원고 본문' } as AppNotification])
  expect(Object.keys(items[0]).sort()).toEqual(['createdAt', 'id', 'kind', 'read', 'summary', 'targetId', 'targetType'])
  expect(JSON.stringify(notificationsMessage('u1', [{ ...n(), body: '비공개 원고 본문' } as AppNotification]))).not.toContain('비공개')
})

it('모바일 앱(mobile/src/bridge.test.ts의 같은 JSON)이 검증하는 형식 그대로 직렬화한다', () => {
  expect(JSON.stringify(notificationsMessage('u1', [n({ targetType: null, targetId: null })]))).toBe(
    '{"type":"storyfork.notifications","userId":"u1","items":[{"id":"n1","kind":"creation","targetType":null,"targetId":null,"summary":"새 회차가 올라왔어요","read":false,"createdAt":"2026-11-26T01:00:00Z"}]}',
  )
  expect(JSON.stringify(logoutMessage)).toBe('{"type":"storyfork.logout"}')
})

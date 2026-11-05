import { expect, it } from 'vitest'

import type { AppNotification } from '../entities/notification'
import {
  applyNotificationRefresh,
  completeMarkAllRead,
  readNotificationsThrough,
  type NotificationListState,
} from '../../presentation/features/inbox/viewmodel/notificationListState'

const n = (id: string, createdAt = `2026-11-05T03:00:${String(id.charCodeAt(0) - 97).padStart(2, '0')}Z`): AppNotification => ({ id, kind: 'creation', summary: id, targetType: null, targetId: null, createdAt, read: false })
const initial = (): NotificationListState => ({ items: [n('c'), n('b')], nextCursor: 'below-b', appliedRefreshSeq: 0, readUpTo: null })
const reads = (items: AppNotification[]) => items.map(({ id, read }) => [id, read])

it('#145 더 늦은 요청이 실패해도 이전 요청의 성공 응답을 반영한다', () => {
  // 요청 2는 실패하여 적용된 성공 순번이 여전히 0이다.
  const result = applyNotificationRefresh(initial(), { items: [n('e'), n('d')], nextCursor: null }, 1)
  expect(result.items.map(({ id }) => id)).toEqual(['e', 'd'])
  expect(result.appliedRefreshSeq).toBe(1)
})

it('#145 더 새로운 성공 뒤에는 늦게 도착한 이전 성공을 무시한다', () => {
  const newer = applyNotificationRefresh(initial(), { items: [n('e'), n('d')], nextCursor: null }, 2)
  expect(applyNotificationRefresh(newer, { items: [n('d'), n('c')], nextCursor: null }, 1)).toBe(newer)
})

it('#144 모두 읽음은 요청 중 추가된 과거 알림도 포함하고 새 알림은 제외한다', () => {
  const current = { ...initial(), items: [n('e'), n('c'), n('b'), n('a')] }
  const result = completeMarkAllRead(current, n('c').createdAt)
  expect(reads(result.items)).toEqual([['e', false], ['c', true], ['b', true], ['a', true]])
  expect(current.items.every(({ read }) => !read)).toBe(true)
})

it('#144 성공 뒤 늦은 SSE 응답에도 읽음 경계를 유지한다', () => {
  const read = completeMarkAllRead(initial(), n('c').createdAt)
  const result = applyNotificationRefresh(read, { items: [n('e'), n('c'), n('b'), n('a')], nextCursor: null }, 1)
  expect(reads(result.items)).toEqual([['e', false], ['c', true], ['b', true], ['a', true]])
})

it('#144 늦은 더 보기 항목에도 성공한 읽음 경계를 적용한다', () => {
  const read = completeMarkAllRead(initial(), n('c').createdAt)
  expect(reads(readNotificationsThrough([n('e'), n('a')], read.readUpTo))).toEqual([['e', false], ['a', true]])
})

it('#144 성공한 모두 읽음이 없으면 알림을 변경하지 않는다', () => {
  const items = initial().items
  expect(readNotificationsThrough(items, null)).toBe(items)
  expect(items.every(({ read }) => !read)).toBe(true)
})

it('#144 중첩된 모두 읽음의 늦은 성공이 읽음 경계를 되돌리지 않는다', () => {
  const newer = completeMarkAllRead(initial(), n('e').createdAt)
  const result = completeMarkAllRead(newer, n('c').createdAt)
  expect(result.readUpTo).toBe(n('e').createdAt)
  expect(readNotificationsThrough([n('d')], result.readUpTo)[0].read).toBe(true)
})

it.each([
  ['2026-11-05T03:00:02.123456788Z', true],
  ['2026-11-05T03:00:02.123456789Z', true],
  ['2026-11-05T03:00:02.123456790Z', false],
  ['2026-11-05T03:00:02.123456Z', true],
  ['2026-11-05T03:00:02.124Z', false],
  ['2026-11-05T12:00:02.123456789+09:00', true],
  ['2026-11-05T12:00:02.123456790+09:00', false],
] as const)('#144 나노초와 오프셋을 보존해 createdAt <= upTo를 판단한다: %s', (createdAt, read) => {
  expect(readNotificationsThrough([n('a', createdAt)], '2026-11-05T03:00:02.123456789Z')[0].read).toBe(read)
})

it.each([
  ['2026-11-05T03:00:02Z', '2026-11-05T03:00:02.000000000Z', true],
  ['2026-11-05T03:00:02.123000000Z', '2026-11-05T03:00:02.123Z', true],
  ['2026-11-05T03:00:02.123000001Z', '2026-11-05T03:00:02.123Z', false],
] as const)('#144 소수 초 자릿수가 달라도 같은 시각과 직후를 구분한다: %s', (createdAt, upTo, read) => {
  expect(readNotificationsThrough([n('a', createdAt)], upTo)[0].read).toBe(read)
})

import { expect, it } from 'vitest'

import type { AppNotification } from '../../../../domain/entities/notification'
import { mergeFirstPage } from './mergeFirstPage'

const n = (id: string): AppNotification => ({ id, kind: 'creation', summary: id, targetType: null, targetId: null, createdAt: '2026-11-05T03:00:00Z', read: false })
const ids = (items: AppNotification[]) => items.map((i) => i.id)

it('첫 페이지가 전체를 덮으면 그대로 바꾼다(다른 곳에서 지운 알림은 사라진다)', () => {
  const merged = mergeFirstPage({ items: [n('a'), n('b')], nextCursor: null }, { items: [n('b')], nextCursor: null })
  expect(ids(merged.items)).toEqual(['b'])
  expect(merged.nextCursor).toBeNull()
})

it('겹치면 겹친 마지막 알림 뒤에 이미 불러온 오래된 알림을 이어 붙이고 기존 cursor를 유지한다', () => {
  const merged = mergeFirstPage({ items: [n('c'), n('b'), n('a'), n('z')], nextCursor: 'old' }, { items: [n('d'), n('c'), n('b')], nextCursor: 'new' })
  expect(ids(merged.items)).toEqual(['d', 'c', 'b', 'a', 'z'])
  expect(merged.nextCursor).toBe('old')
})

it('다른 곳에서 지운 알림은 겹친 구간에서 빠진다', () => {
  const merged = mergeFirstPage({ items: [n('c'), n('b'), n('a')], nextCursor: 'old' }, { items: [n('c'), n('a')], nextCursor: 'new' })
  expect(ids(merged.items)).toEqual(['c', 'a'])
})

it('겹치지 않으면(한 페이지 넘게 새로 도착) 새 첫 페이지와 새 cursor로 다시 시작해 사이 알림을 놓치지 않는다', () => {
  const merged = mergeFirstPage({ items: [n('c'), n('b')], nextCursor: null }, { items: [n('h'), n('g')], nextCursor: 'gap' })
  expect(ids(merged.items)).toEqual(['h', 'g'])
  expect(merged.nextCursor).toBe('gap')
})

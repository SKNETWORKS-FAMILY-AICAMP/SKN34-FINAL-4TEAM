import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { arrivals } from './arrivals.ts'
import type { AppNotification } from './notification.ts'

const n = (id: string, createdAt = '2026-11-26T01:00:00Z', read = false): AppNotification =>
  ({ id, kind: 'creation', summary: id, targetType: 'work', targetId: 'w1', createdAt, read })
const ids = (items: AppNotification[]) => items.map((i) => i.id)

describe('arrivals (로컬 알림을 띄울지 판정)', () => {
  it('첫 조회는 기준선만 만들고 아무것도 알리지 않는다', () => {
    const first = arrivals([n('b'), n('a')], null)
    assert.deepEqual(first.fresh, [])
    assert.deepEqual([...first.seen].sort(), ['a@2026-11-26T01:00:00Z', 'b@2026-11-26T01:00:00Z'])
  })

  it('기준선 뒤 새로 도착한 읽지 않은 알림만 오래된 순으로 알린다', () => {
    const { seen } = arrivals([n('a')], null)
    const next = arrivals([n('c'), n('b'), n('a')], seen)
    assert.deepEqual(ids(next.fresh), ['b', 'c'])
  })

  it('한 번 본 알림은 다시 알리지 않는다', () => {
    const { seen } = arrivals([n('a')], null)
    const again = arrivals([n('b'), n('a')], seen)
    assert.deepEqual(ids(arrivals([n('b'), n('a')], again.seen).fresh), [])
  })

  it('이미 읽은 알림(다른 기기에서 읽음)은 새로 보여도 알리지 않는다', () => {
    const { seen } = arrivals([], null)
    assert.deepEqual(arrivals([n('a', '2026-11-26T01:00:00Z', true)], seen).fresh, [])
  })

  it('같은 알림의 시각만 올라가면(ai-tool 묶음 갱신) 새 알림으로 본다', () => {
    const { seen } = arrivals([n('a', '2026-11-26T01:00:00Z')], null)
    assert.deepEqual(ids(arrivals([n('a', '2026-11-26T02:00:00Z')], seen).fresh), ['a'])
  })

  it('입력 집합을 바꾸지 않는다', () => {
    const { seen } = arrivals([n('a')], null)
    const before = [...seen]
    arrivals([n('b')], seen)
    assert.deepEqual([...seen], before)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { initialBridgeState, receive } from './bridge.ts'
import type { AppNotification } from './notification.ts'

const item = (id: string, over: Partial<AppNotification> = {}): AppNotification =>
  ({ id, kind: 'creation', summary: id, targetType: 'work', targetId: 'w1', createdAt: '2026-11-26T01:00:00Z', read: false, ...over })
const notifications = (userId: string, items: unknown[]) => JSON.stringify({ type: 'storyfork.notifications', userId, items })
const ids = (r: { fresh: AppNotification[] }) => r.fresh.map((n) => n.id)

describe('receive (웹 → 앱 메시지)', () => {
  it('알림 목록을 받기 전에도 로그인한 WebView를 확인하고 최초 목록은 기준선으로 둔다', () => {
    const ready = receive(initialBridgeState, JSON.stringify({ type: 'storyfork.ready', account: 'u1' }))
    assert.equal(ready.state.userId, 'u1')
    assert.deepEqual(receive(ready.state, notifications('u1', [item('a')])).fresh, [])
    assert.deepEqual(receive(ready.state, JSON.stringify({ type: 'storyfork.ready', account: null })).state, initialBridgeState)
  })
  it('로그인 뒤 첫 알림 목록은 기준선만 만들고 알리지 않는다', () => {
    const first = receive(initialBridgeState, notifications('u1', [item('b'), item('a')]))
    assert.deepEqual(first.fresh, [])
    assert.equal(first.state.userId, 'u1')
  })

  it('기준선 뒤 새로 도착한 읽지 않은 알림만 오래된 순으로 알리고, 한 번 알린 것은 다시 알리지 않는다', () => {
    const base = receive(initialBridgeState, notifications('u1', [item('a')])).state
    const next = receive(base, notifications('u1', [item('c'), item('b'), item('a')]))
    assert.deepEqual(ids(next), ['b', 'c'])
    assert.deepEqual(ids(receive(next.state, notifications('u1', [item('c'), item('b'), item('a')]))), [])
  })

  it('이미 읽은 알림은 새로 보여도 알리지 않는다', () => {
    const base = receive(initialBridgeState, notifications('u1', [])).state
    assert.deepEqual(ids(receive(base, notifications('u1', [item('a', { read: true })]))), [])
  })

  it('계정이 바뀌면 기준선부터 다시 시작해 다른 사람의 알림 목록을 새 알림으로 알리지 않는다', () => {
    const u1 = receive(initialBridgeState, notifications('u1', [item('a')])).state
    const switched = receive(u1, notifications('u2', [item('x'), item('y')]))
    assert.deepEqual(switched.fresh, [])
    assert.equal(switched.state.userId, 'u2')
    assert.deepEqual(ids(receive(switched.state, notifications('u2', [item('z'), item('x'), item('y')]))), ['z'])
  })

  it('로그아웃 메시지는 기준선을 비운다(다시 로그인하면 첫 목록은 또 기준선)', () => {
    const base = receive(initialBridgeState, notifications('u1', [item('a')])).state
    const out = receive(base, JSON.stringify({ type: 'storyfork.logout' }))
    assert.deepEqual(out, { state: initialBridgeState, fresh: [] })
    assert.deepEqual(receive(out.state, notifications('u1', [item('a'), item('b')])).fresh, [])
  })

  it('형식이 다른 메시지(JSON 아님·모르는 type·필드 누락·모르는 분류)는 무시하고 상태를 바꾸지 않는다', () => {
    const base = receive(initialBridgeState, notifications('u1', [item('a')])).state
    for (const raw of [
      'not json', '', 'null', '[]', JSON.stringify({ type: 'other' }),
      JSON.stringify({ type: 'storyfork.notifications', items: [] }),
      JSON.stringify({ type: 'storyfork.notifications', userId: '', items: [] }),
      JSON.stringify({ type: 'storyfork.notifications', userId: 'u1' }),
      notifications('u1', [{ ...item('b'), kind: 'unknown' }]),
      notifications('u1', [{ ...item('b'), createdAt: 'yesterday' }]),
      notifications('u1', [{ id: 'b' }]),
    ]) {
      assert.deepEqual(receive(base, raw), { state: base, fresh: [] }, raw)
    }
  })

  it('웹(frontend nativeBridge.test.ts)이 보내는 JSON 그대로 받는다', () => {
    const web = '{"type":"storyfork.notifications","userId":"u1","items":[{"id":"n1","kind":"creation","targetType":null,"targetId":null,"summary":"새 회차가 올라왔어요","read":false,"createdAt":"2026-11-26T01:00:00Z"}]}'
    const first = receive(initialBridgeState, web)
    assert.equal(first.state.userId, 'u1')
    assert.deepEqual(first.fresh, [])
    assert.deepEqual(receive(first.state, web.replace('"n1"', '"n2"')).fresh.map((n) => n.id), ['n2'])
    assert.deepEqual(receive(first.state, '{"type":"storyfork.logout"}').state, initialBridgeState)
  })

  it('알림 항목의 모르는 필드는 버린다(앱은 정해진 필드만 쓴다)', () => {
    const base = receive(initialBridgeState, notifications('u1', [])).state
    const [fresh] = receive(base, notifications('u1', [{ ...item('a'), body: '비공개 원고 본문' }])).fresh
    assert.deepEqual(Object.keys(fresh).sort(), ['createdAt', 'id', 'kind', 'read', 'summary', 'targetId', 'targetType'])
  })
})

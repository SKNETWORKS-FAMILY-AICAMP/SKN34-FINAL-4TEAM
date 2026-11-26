import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearInbox, newNotices, parseWebMessage, trustedPage } from '../noticeBridge.ts'

const first = { id: 'f91943a2-8b52-4a6b-a4d1-73734229aeab', summary: '새 회차', createdAt: '2026-11-26T04:00:00Z', read: false }
const second = { ...first, id: '4d13471f-6e9b-4d45-b00a-4bf94d95fb19', createdAt: '2026-11-26T04:00:01Z' }

test('첫 목록은 기준으로 삼고 새 알림과 같은 ID로 갱신된 알림만 띄운다', () => {
  const inbox = clearInbox()
  assert.deepEqual(newNotices(inbox, [first]), [])
  assert.deepEqual(newNotices(inbox, [second, first]), [second])
  assert.deepEqual(newNotices(inbox, [second, first]), [])
  const merged = { ...first, createdAt: '2026-11-26T04:00:02Z' }
  assert.deepEqual(newNotices(inbox, [merged, second]), [merged])
  assert.deepEqual(newNotices(inbox, [{ ...second, read: true }]), [])
  assert.deepEqual(newNotices(inbox, [first]), [])
  assert.deepEqual(newNotices(clearInbox(), [second, first]), [])
})

test('신뢰한 원본과 정해진 브리지 메시지만 받는다', () => {
  const origin = 'https://storyfork.example'
  assert.equal(trustedPage(origin, origin + '/notifications'), true)
  for (const untrusted of ['https://storyfork.example.evil/', 'https://storyfork.example@evil/', 'http://storyfork.example/', 'about:blank']) {
    assert.equal(trustedPage(origin, untrusted), false)
  }
  assert.deepEqual(parseWebMessage(JSON.stringify({ type: 'storyfork.notices', items: [first] })),
    { type: 'storyfork.notices', items: [first] })
  assert.equal(parseWebMessage('{'), null)
  assert.equal(parseWebMessage(JSON.stringify({ type: 'storyfork.notices', items: [{ ...first, createdAt: 'yesterday' }] })), null)
})

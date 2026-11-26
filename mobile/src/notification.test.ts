import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { noticeLabel, noticeTarget, payloadTarget, pushNoticeId, shouldRequestNotificationPermission } from './notification.ts'

it('Android가 초기 denied 상태를 반환해도 권한을 한 번 요청하고 실제 알림 UUID만 전달한다', () => {
  const initial = { status: 'denied', granted: false, canAskAgain: true }
  assert.equal(shouldRequestNotificationPermission(initial, false), true)
  assert.equal(shouldRequestNotificationPermission(initial, true), false)
  assert.equal(shouldRequestNotificationPermission({ ...initial, canAskAgain: false }, false), false)
  const id = '7565d1dc-ae47-4fdf-af1c-cf278520a7e0'
  assert.equal(pushNoticeId({ noticeId: id }), id)
  assert.equal(pushNoticeId({ noticeId: '/admin' }), null)
})

// 웹 frontend/src/domain/__tests__/noticeTarget.test.ts와 같은 기대값이다. 규칙을 고치면 두 곳을 함께 고친다.
describe('noticeTarget', () => {
  it('작품 알림은 작품 상세로, Core 크레딧 소멸 예정·탈퇴 요청 알림은 본인 계정 화면으로 보낸다', () => {
    assert.equal(noticeTarget({ kind: 'creation', targetType: 'work', targetId: 'a b' }), '/work/a%20b')
    assert.equal(noticeTarget({ kind: 'credit', targetType: 'credit-expiry', targetId: '2026-12-01' }), '/me/pay')
    assert.equal(noticeTarget({ kind: 'rights-security', targetType: 'withdrawal', targetId: 'w1' }), '/me/profile?focus=withdrawal')
  })

  it('AI·외부 도구 변경 알림은 세계관이면 세계관 관리로, 작품이면 집필실로 보낸다', () => {
    assert.equal(noticeTarget({ kind: 'ai-tool', targetType: 'world', targetId: 'w 1' }), '/worldstudio/w%201')
    assert.equal(noticeTarget({ kind: 'ai-tool', targetType: 'work', targetId: 'a b' }), '/studio/a%20b')
  })

  it('같은 work 대상이어도 AI·외부 도구 변경이 아닌 분류는 작품 상세로 보낸다(운영자 조치 알림 = 처리 결과 + work)', () => {
    assert.equal(noticeTarget({ kind: 'result', targetType: 'work', targetId: 'a b' }), '/work/a%20b')
  })

  it('운영 경고 알림(대상 alert)은 대상 id를 주소에 쓰지 않고 LLM Ops 경고·누설 감시 쪽으로 보낸다', () => {
    assert.equal(noticeTarget({ kind: 'result', targetType: 'alert', targetId: '3f2c9a10-0000-4000-8000-000000000001' }), '/admin?tab=llm&view=alerts')
    assert.equal(noticeTarget({ kind: 'result', targetType: 'alert', targetId: null }), '/admin?tab=llm&view=alerts')
  })

  it('모르는 대상이나 id 없는 작품·세계관 알림은 이동하지 않는다', () => {
    assert.equal(noticeTarget({ kind: 'creation', targetType: 'work', targetId: null }), null)
    assert.equal(noticeTarget({ kind: 'ai-tool', targetType: 'work', targetId: null }), null)
    assert.equal(noticeTarget({ kind: 'ai-tool', targetType: 'world', targetId: null }), null)
    assert.equal(noticeTarget({ kind: 'ai-tool', targetType: 'comment', targetId: 'c1' }), null)
    assert.equal(noticeTarget({ kind: 'creation', targetType: 'world', targetId: 'w1' }), null)
    assert.equal(noticeTarget({ kind: 'result', targetType: null, targetId: null }), null)
  })
})

describe('noticeLabel', () => {
  it('분류의 표시 이름', () => {
    assert.equal(noticeLabel('ai-tool'), 'AI·외부 도구 변경')
    assert.equal(noticeLabel('creation'), '작가 소식')
  })
})

describe('payloadTarget', () => {
  it('로컬·원격 알림 데이터(kind·targetType·targetId)에서 같은 규칙으로 이동 주소를 만든다', () => {
    assert.equal(payloadTarget({ kind: 'creation', targetType: 'work', targetId: 'w1' }), '/work/w1')
    assert.equal(payloadTarget({ kind: 'ai-tool', targetType: 'world', targetId: 'w 1' }), '/worldstudio/w%201')
    assert.equal(payloadTarget({ kind: 'credit', targetType: 'credit-expiry' }), '/me/pay')
  })

  it('데이터가 없거나 모르는 분류·형식이면 이동하지 않는다', () => {
    assert.equal(payloadTarget(undefined), null)
    assert.equal(payloadTarget(null), null)
    assert.equal(payloadTarget('work'), null)
    assert.equal(payloadTarget({}), null)
    assert.equal(payloadTarget({ kind: 'unknown', targetType: 'work', targetId: 'w1' }), null)
    assert.equal(payloadTarget({ kind: 'creation', targetType: 'work', targetId: 7 }), null)
  })
})

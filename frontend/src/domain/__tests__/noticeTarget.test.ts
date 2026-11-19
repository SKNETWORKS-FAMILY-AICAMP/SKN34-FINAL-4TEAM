import { describe, expect, it } from 'vitest'

import { noticeTarget } from '../entities/notification'

describe('noticeTarget', () => {
  it('작품 알림은 작품 상세로, Core 크레딧 소멸 예정·탈퇴 요청 알림은 본인 계정 화면으로 보낸다', () => {
    expect(noticeTarget({ targetType: 'work', targetId: 'a b' })).toBe('/work/a%20b')
    expect(noticeTarget({ targetType: 'credit-expiry', targetId: '2026-12-01' })).toBe('/me/pay')
    expect(noticeTarget({ targetType: 'withdrawal', targetId: 'w1' })).toBe('/me/profile?focus=withdrawal')
  })

  it('운영 경고 알림(operations.alert.raised, 대상 alert)은 대상 id를 주소에 쓰지 않고 경고를 보는 LLM Ops 탭으로 보낸다', () => {
    expect(noticeTarget({ targetType: 'alert', targetId: '3f2c9a10-0000-4000-8000-000000000001' })).toBe('/admin?tab=llm')
    expect(noticeTarget({ targetType: 'alert', targetId: null })).toBe('/admin?tab=llm')
  })

  it('모르는 대상이나 id 없는 작품 알림은 이동하지 않는다', () => {
    expect(noticeTarget({ targetType: 'work', targetId: null })).toBeNull()
    expect(noticeTarget({ targetType: 'comment', targetId: 'c1' })).toBeNull()
    expect(noticeTarget({ targetType: null, targetId: null })).toBeNull()
  })
})

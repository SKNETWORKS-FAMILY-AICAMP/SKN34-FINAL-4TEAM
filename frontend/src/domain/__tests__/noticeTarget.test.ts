import { describe, expect, it } from 'vitest'

import { noticeLabel, noticeTarget } from '../entities/notification'

describe('noticeTarget', () => {
  it('작품 알림은 작품 상세로, Core 크레딧 소멸 예정·탈퇴 요청 알림은 본인 계정 화면으로 보낸다', () => {
    expect(noticeTarget({ kind: 'creation', targetType: 'work', targetId: 'a b' })).toBe('/work/a%20b')
    expect(noticeTarget({ kind: 'credit', targetType: 'credit-expiry', targetId: '2026-12-01' })).toBe('/me/pay')
    expect(noticeTarget({ kind: 'rights-security', targetType: 'withdrawal', targetId: 'w1' })).toBe('/me/profile?focus=withdrawal')
  })

  it('AI·외부 도구 변경 알림은 세계관이면 세계관 관리로, 작품이면 집필실로 보낸다', () => {
    expect(noticeTarget({ kind: 'ai-tool', targetType: 'world', targetId: 'w 1' })).toBe('/worldstudio/w%201')
    expect(noticeTarget({ kind: 'ai-tool', targetType: 'work', targetId: 'a b' })).toBe('/studio/a%20b')
  })

  it('같은 work 대상이어도 AI·외부 도구 변경이 아닌 분류는 작품 상세로 보낸다(운영자 조치 알림 = 처리 결과 + work)', () => {
    expect(noticeTarget({ kind: 'result', targetType: 'work', targetId: 'a b' })).toBe('/work/a%20b')
  })

  it('운영자 세계관 제한·해제 알림(처리 결과 + world)도 세계관 관리로 보낸다(#941: 분류가 result라 이동 경로가 없었다)', () => {
    expect(noticeTarget({ kind: 'result', targetType: 'world', targetId: 'w 1' })).toBe('/worldstudio/w%201')
  })

  it('운영 경고 알림(operations.alert.raised, 대상 alert)은 대상 id를 주소에 쓰지 않고 경고를 보는 LLM Ops 경고·누설 감시 쪽으로 보낸다(#857: 기본 쪽이 추적·지표가 돼 view를 붙인다)', () => {
    expect(noticeTarget({ kind: 'result', targetType: 'alert', targetId: '3f2c9a10-0000-4000-8000-000000000001' })).toBe('/admin?tab=llm&view=alerts')
    expect(noticeTarget({ kind: 'result', targetType: 'alert', targetId: null })).toBe('/admin?tab=llm&view=alerts')
  })

  it('모르는 대상이나 id 없는 작품·세계관 알림은 이동하지 않는다', () => {
    expect(noticeTarget({ kind: 'creation', targetType: 'work', targetId: null })).toBeNull()
    expect(noticeTarget({ kind: 'ai-tool', targetType: 'work', targetId: null })).toBeNull()
    expect(noticeTarget({ kind: 'ai-tool', targetType: 'world', targetId: null })).toBeNull()
    expect(noticeTarget({ kind: 'ai-tool', targetType: 'comment', targetId: 'c1' })).toBeNull()
    expect(noticeTarget({ kind: 'creation', targetType: 'world', targetId: 'w1' })).toBeNull()
    expect(noticeTarget({ kind: 'result', targetType: null, targetId: null })).toBeNull()
  })
})

describe('noticeLabel', () => {
  it('AI·외부 도구 변경 분류의 표시 이름', () => {
    expect(noticeLabel('ai-tool')).toBe('AI·외부 도구 변경')
  })
})

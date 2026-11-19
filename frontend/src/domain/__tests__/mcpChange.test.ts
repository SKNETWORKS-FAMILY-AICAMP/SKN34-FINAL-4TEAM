import { describe, expect, it } from 'vitest'

import { type AppNotification, mcpChange } from '../entities/notification'

const work = { targetType: 'work', targetId: 'w1' }
const n = (createdAt: string, over: Partial<AppNotification> = {}): AppNotification => ({
  id: `n-${createdAt}`, kind: 'ai-tool', summary: 'AI가 MCP로 작품을 수정했어요', targetType: 'work', targetId: 'w1', createdAt, read: false, ...over,
})
const T0 = '2026-11-19T03:00:00Z'
const T1 = '2026-11-19T03:00:05Z'

describe('mcpChange (#553 화면 자동 새로고침 판정)', () => {
  it('처음 읽은 값이 기준선이다: 화면을 열 때 이미 있던 알림은 변경으로 보지 않는다', () => {
    expect(mcpChange([n(T0)], work, undefined)).toEqual({ baseline: T0, changed: false })
  })

  it('처음 읽었을 때 열린 대상의 알림이 없으면 기준선은 null이고 변경이 아니다', () => {
    expect(mcpChange([], work, undefined)).toEqual({ baseline: null, changed: false })
  })

  it('기준선보다 뒤의 알림이 오면 변경이고 기준선이 그 시각으로 옮겨 간다', () => {
    expect(mcpChange([n(T1), n(T0)], work, T0)).toEqual({ baseline: T1, changed: true })
  })

  it('처음에 알림이 없었다면(null) 첫 알림이 와도 변경이다', () => {
    expect(mcpChange([n(T0)], work, null)).toEqual({ baseline: T0, changed: true })
  })

  it('같은 알림의 시각만 올라가도(Core가 연속 저장을 한 알림으로 묶음) 변경이다', () => {
    expect(mcpChange([n(T1, { id: 'same' })], work, T0)).toEqual({ baseline: T1, changed: true })
  })

  it('기준선과 같거나 이른 알림은 변경이 아니고 기준선은 그대로다', () => {
    expect(mcpChange([n(T0)], work, T0)).toEqual({ baseline: T0, changed: false })
    expect(mcpChange([n(T0)], work, T1)).toEqual({ baseline: T1, changed: false })
  })

  it('가장 늦은 시각을 쓴다(목록 순서와 무관)', () => {
    expect(mcpChange([n(T0), n('2026-11-19T03:00:09Z'), n(T1)], work, T0)).toEqual({ baseline: '2026-11-19T03:00:09Z', changed: true })
  })

  it('다른 대상이나 AI·외부 도구 변경이 아닌 알림은 무시한다: 같은 작품의 운영자 조치(처리 결과)·작가 소식으로는 새로고침하지 않는다', () => {
    const later = '2026-11-19T04:00:00Z'
    const ignored = [
      n(later, { kind: 'result' }),
      n(later, { kind: 'creation' }),
      n(later, { targetId: 'other' }),
      n(later, { targetType: 'world' }),
      n(later, { targetId: null }),
    ]
    expect(mcpChange(ignored, work, T0)).toEqual({ baseline: T0, changed: false })
    expect(mcpChange(ignored, work, undefined)).toEqual({ baseline: null, changed: false })
  })

  it('세계관 대상은 world 종류와 세계관 id가 모두 같을 때만 본다', () => {
    const world = { targetType: 'world', targetId: 'w1' }
    expect(mcpChange([n(T1, { targetType: 'world' })], world, T0)).toEqual({ baseline: T1, changed: true })
    expect(mcpChange([n(T1)], world, T0)).toEqual({ baseline: T0, changed: false })
  })

  it('알림을 지우거나 밀려나 최신 시각이 줄어도 기준선은 뒤로 가지 않는다', () => {
    expect(mcpChange([n(T0)], work, T1)).toEqual({ baseline: T1, changed: false })
    expect(mcpChange([], work, T1)).toEqual({ baseline: T1, changed: false })
  })

  it('시각은 글자 순서가 아니라 시점으로 비교한다(오프셋·소수 자릿수가 달라도)', () => {
    // 글자로 비교하면 '…T03:00:01Z' < '…T12:00:00+09:00'이라 놓친다(실제로는 1초 뒤).
    expect(mcpChange([n('2026-11-19T03:00:01Z')], work, '2026-11-19T12:00:00+09:00')).toEqual({ baseline: '2026-11-19T03:00:01Z', changed: true })
    // 글자로 비교하면 '.'이 'Z'보다 앞이라 '…00.500Z' < '…00Z'로 놓친다(실제로는 0.5초 뒤).
    expect(mcpChange([n('2026-11-19T03:00:00.500Z')], work, T0)).toEqual({ baseline: '2026-11-19T03:00:00.500Z', changed: true })
  })
})

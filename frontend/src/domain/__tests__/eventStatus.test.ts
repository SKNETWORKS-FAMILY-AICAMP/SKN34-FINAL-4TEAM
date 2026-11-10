import { describe, expect, it } from 'vitest'

import { EVENT_STATUS_LABELS, eventStatus } from '../entities/event'

const NOW = new Date('2026-11-09T00:00:00.000Z')
const before = '2026-11-08T00:00:00Z'
const after = '2026-11-10T00:00:00Z'

describe('이벤트 진행 상태 계산 (운영 이벤트 계약)', () => {
  it('시작·종료가 모두 없으면 상시다', () => {
    expect(eventStatus({ startsAt: null, endsAt: null }, NOW)).toBe('always')
  })

  it('시작이 현재보다 늦으면 예정이고, 시작 시각 정각부터는 진행 중이다', () => {
    expect(eventStatus({ startsAt: after, endsAt: null }, NOW)).toBe('upcoming')
    expect(eventStatus({ startsAt: after, endsAt: '2026-11-11T00:00:00Z' }, NOW)).toBe('upcoming')
    expect(eventStatus({ startsAt: NOW.toISOString(), endsAt: null }, NOW)).toBe('ongoing')
  })

  it('종료 시각 정각부터 종료이고, 그 직전까지는 진행 중이다', () => {
    expect(eventStatus({ startsAt: null, endsAt: NOW.toISOString() }, NOW)).toBe('ended')
    expect(eventStatus({ startsAt: null, endsAt: '2026-11-09T00:00:00.001Z' }, NOW)).toBe('ongoing')
    expect(eventStatus({ startsAt: before, endsAt: '2026-11-08T12:00:00Z' }, NOW)).toBe('ended')
  })

  it('한쪽 기간만 있어도 규칙대로 계산한다', () => {
    expect(eventStatus({ startsAt: before, endsAt: null }, NOW)).toBe('ongoing')
    expect(eventStatus({ startsAt: null, endsAt: after }, NOW)).toBe('ongoing')
    expect(eventStatus({ startsAt: before, endsAt: after }, NOW)).toBe('ongoing')
  })

  it('시작과 종료가 같은 이벤트는 그 시각 전에는 예정, 그 시각부터는 종료다', () => {
    const same = { startsAt: NOW.toISOString(), endsAt: NOW.toISOString() }
    expect(eventStatus(same, new Date(NOW.getTime() - 1))).toBe('upcoming')
    expect(eventStatus(same, NOW)).toBe('ended')
  })

  it('서버 UTC 시각은 오프셋 표기와 상관없이 같은 순간으로 비교한다', () => {
    // 2026-11-09T09:00+09:00 == 2026-11-09T00:00Z
    expect(eventStatus({ startsAt: '2026-11-09T09:00:00+09:00', endsAt: null }, NOW)).toBe('ongoing')
    expect(eventStatus({ startsAt: '2026-11-09T09:00:01+09:00', endsAt: null }, NOW)).toBe('upcoming')
  })

  it('화면 라벨은 계약의 한글 이름을 쓴다', () => {
    expect(EVENT_STATUS_LABELS).toEqual({ always: '상시', upcoming: '예정', ongoing: '진행 중', ended: '종료' })
  })
})

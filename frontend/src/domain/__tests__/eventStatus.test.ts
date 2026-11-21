import { describe, expect, it } from 'vitest'

import { EVENT_STATUS_LABELS, eventStatus, isSitePath } from '../entities/event'

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

describe('이벤트 이동 경로 (DEC-57, 사이트 안 경로만)', () => {
  it.each([['/', '/'], ['/lib', '/lib'], ['쿼리·해시', '/work/abc?tab=2#top'], ['쿼리', '/me/event?id=0b6f'], ['200자', '/' + 'a'.repeat(199)]])('%s 경로는 받는다', (_name, path) => {
    expect(isSitePath(path)).toBe(true)
  })

  it.each([
    ['빈 값', ''], ['/로 시작하지 않음', 'lib'], ['외부 URL', 'https://evil.example'], ['스크립트', 'javascript:alert(1)'], ['프로토콜 상대', '//evil.example'], ['/ 안의 ://', '/a://b'],
    ['안의 공백', '/a b'], ['앞 공백', ' /lib'], ['뒤 공백', '/lib '], ['탭', '/a\tb'], ['백슬래시', '/\\evil.example'], ['201자', '/' + 'a'.repeat(200)],
  ])('%s는 받지 않는다', (_name, path) => {
    expect(isSitePath(path)).toBe(false)
  })

  it('경로가 없으면(null·undefined) 받지 않는다', () => {
    expect([isSitePath(null), isSitePath(undefined)]).toEqual([false, false])
  })
})

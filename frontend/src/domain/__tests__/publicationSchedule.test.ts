import { describe, expect, it } from 'vitest'

import { resultReloadDelay } from '../entities/publicationSchedule'

describe('예약 결과 다시 읽기 지연', () => {
  const now = Date.parse('2026-11-10T00:00:00.000Z')
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString()

  it('예약 시각 6초 뒤(스케줄러 5초 주기 다음)에 한 번 읽도록 남은 시간을 돌려준다', () => {
    expect(resultReloadDelay(at(60_000), now)).toBe(66_000)
    expect(resultReloadDelay(at(-3_000), now)).toBe(3_000)
  })

  it('6초가 이미 지났으면 다시 읽지 않는다', () => {
    expect(resultReloadDelay(at(-6_000), now)).toBeNull()
    expect(resultReloadDelay(at(-60_000), now)).toBeNull()
  })

  it('setTimeout 최대값(2^31-1ms)을 넘으면 즉시 실행되므로 타이머를 걸지 않는다', () => {
    const max = 2 ** 31 - 1
    expect(resultReloadDelay(at(max - 6_000), now)).toBe(max)
    expect(resultReloadDelay(at(max - 6_000 + 1), now)).toBeNull()
  })
})

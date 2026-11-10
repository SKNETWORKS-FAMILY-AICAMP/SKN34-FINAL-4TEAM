import { describe, expect, it } from 'vitest'

import { asOf } from './format'

describe('asOf (순위 계산 시각)', () => {
  it('서버가 계산한 시각을 브라우저 시간대와 무관하게 한국시간 "HH:mm 기준"으로 보인다', () => {
    expect(asOf(new Date('2026-11-10T05:07:30.123Z'))).toBe('14:07 기준')
    expect(asOf(new Date('2026-11-10T14:59:59Z'))).toBe('23:59 기준')
  })

  it('자정 직후는 24:05가 아니라 00:05로 보인다', () => {
    expect(asOf(new Date('2026-11-10T15:05:00Z'))).toBe('00:05 기준')
  })
})

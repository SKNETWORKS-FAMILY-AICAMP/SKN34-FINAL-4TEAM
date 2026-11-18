import { describe, expect, it } from 'vitest'

import { hasMorePages, lineageOrigins } from '../entities/publicWorld'

const known = new Set(['a', 'b', 'c', 'd'])

describe('파생·조합 원본 해석', () => {
  it('파생 원본 하나를 먼저, 조합 원본들을 적힌 순서로 돌려준다', () => {
    expect(lineageOrigins({ id: 'd', derivedFrom: 'a' }, known)).toEqual([{ id: 'a', kind: 'derive' }])
    expect(lineageOrigins({ id: 'd', combinedFrom: ['c', 'a'] }, known)).toEqual([{ id: 'c', kind: 'combine' }, { id: 'a', kind: 'combine' }])
  })

  it('원본이 없는 세계관은 빈 목록이다', () => {
    expect(lineageOrigins({ id: 'a' }, known)).toEqual([])
  })

  it('목록에 없는 id·자기 자신은 버리고 조합 안의 중복 원본은 한 번만 센다', () => {
    expect(lineageOrigins({ id: 'x', derivedFrom: 'ghost' }, known)).toEqual([])
    expect(lineageOrigins({ id: 'a', derivedFrom: 'a' }, known)).toEqual([])
    expect(lineageOrigins({ id: 'd', combinedFrom: ['d', 'ghost', 'a', 'a'] }, known)).toEqual([{ id: 'a', kind: 'combine' }])
  })
})

describe('검색 결과 더 보기 판정 (#505)', () => {
  /** 서버가 `served`개를 준 `number`쪽 응답 */
  const answer = (served: number, number: number, size: number, total: number) => ({ items: Array.from({ length: served }, (_, i) => i), page: number, size, total })

  it('서버가 이 쪽까지 준 수가 total보다 적으면 더 있고 total에 닿으면 없다', () => {
    expect(hasMorePages(answer(2, 0, 2, 5))).toBe(true)
    expect(hasMorePages(answer(2, 1, 2, 5))).toBe(true) // 4 < 5
    expect(hasMorePages(answer(1, 2, 2, 5))).toBe(false) // 5 = 5
    expect(hasMorePages(answer(2, 0, 2, 2))).toBe(false)
  })

  it('쪽이 비어 돌아오면 total이 남았어도 멈춘다(읽는 사이 목록이 줄어든 경우 빈 쪽을 끝없이 요청하지 않는다)', () => {
    expect(hasMorePages(answer(0, 1, 2, 5))).toBe(false)
    expect(hasMorePages(answer(0, 0, 24, 0))).toBe(false)
  })
})

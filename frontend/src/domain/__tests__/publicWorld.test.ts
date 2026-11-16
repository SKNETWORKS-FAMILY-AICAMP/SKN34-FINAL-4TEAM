import { describe, expect, it } from 'vitest'

import { lineageOrigins } from '../entities/publicWorld'

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

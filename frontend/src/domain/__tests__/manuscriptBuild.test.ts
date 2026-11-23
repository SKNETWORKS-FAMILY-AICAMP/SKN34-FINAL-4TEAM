import { describe, expect, it } from 'vitest'

import { worldBuildBadge } from '../entities/manuscriptBuild'

const ACTIVE = ['queued', 'running', 'loading']
const IDLE = ['failed', 'unknown', 'completed']

describe('공개 회차 머리의 세계관 배지(initial-build-storage-contract)', () => {
  it.each(ACTIVE)('최초 구축이 %s이면 \'세계관 추출 중\'이다', (status) => {
    expect(worldBuildBadge({ status })).toBe('세계관 추출 중')
  })

  it.each(IDLE)('최초 구축이 %s이고 업데이트가 없으면(없음·null) 배지가 없다', (status) => {
    expect(worldBuildBadge({ status })).toBeNull()
    expect(worldBuildBadge({ status, update: null })).toBeNull()
  })

  it.each(ACTIVE)('최초 구축이 끝났고 업데이트가 %s이면 \'세계관 업데이트 중\'이다', (status) => {
    expect(worldBuildBadge({ status: 'completed', update: { status } })).toBe('세계관 업데이트 중')
  })

  it.each(IDLE)('업데이트가 %s이면 배지가 없다(실패를 진행 중으로 보이지 않는다)', (status) => {
    expect(worldBuildBadge({ status: 'completed', update: { status } })).toBeNull()
  })

  it('둘 다 진행 중이면 \'세계관 추출 중\'이 먼저다', () => {
    expect(worldBuildBadge({ status: 'running', update: { status: 'running' } })).toBe('세계관 추출 중')
  })

  it('작업이 없으면(null·undefined) 배지가 없다', () => {
    expect(worldBuildBadge(null)).toBeNull()
    expect(worldBuildBadge(undefined)).toBeNull()
  })
})

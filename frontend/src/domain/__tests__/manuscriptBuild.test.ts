import { describe, expect, it } from 'vitest'

import { initialBuildCompletedOn, worldBuildBadge } from '../entities/manuscriptBuild'

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

describe('최초 구축 완료 판정(initial-build-storage-contract 업로드 자동 시작)', () => {
  const done = { status: 'completed', worldId: 'linked' }

  it('완료됐고 현재 연결된 세계관의 작업이면 true다', () => {
    expect(initialBuildCompletedOn(done, 'linked')).toBe(true)
  })

  it('다른 세계관의 완료는 false다', () => {
    expect(initialBuildCompletedOn(done, 'other')).toBe(false)
  })

  it.each([...ACTIVE, 'failed', 'unknown'])('같은 세계관이어도 %s이면 false다', (status) => {
    expect(initialBuildCompletedOn({ status, worldId: 'linked' }, 'linked')).toBe(false)
  })

  it('작업이 없으면(null·undefined) false다', () => {
    expect(initialBuildCompletedOn(null, 'linked')).toBe(false)
    expect(initialBuildCompletedOn(undefined, 'linked')).toBe(false)
  })

  it('연결된 세계관이 없으면(null·undefined) false다', () => {
    expect(initialBuildCompletedOn(done, null)).toBe(false)
    expect(initialBuildCompletedOn(done, undefined)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { writingStatus } from '../entities/writingStatus'

describe('집필 상태', () => {
  const base = { ready: true, busy: false, error: '', dirty: false, active: true, hasDraft: true, inherited: false }
  it('초안을 삭제한 회차를 저장 완료로 표시하지 않는다', () => {
    expect(writingStatus({ ...base, hasDraft: false })).toBe('작업 초안 없음')
  })
  it('삭제 후 새로 입력하면 미저장 상태를 우선한다', () => {
    expect(writingStatus({ ...base, hasDraft: false, dirty: true })).toBe('저장되지 않은 변경')
  })
  it('충돌과 처리 중 상태를 저장 성공으로 표시하지 않는다', () => {
    expect(writingStatus({ ...base, error: '409', dirty: true })).toBe('처리 실패 · 안내를 확인해 주세요')
    expect(writingStatus({ ...base, busy: true })).toBe('처리 중…')
  })
  it('원작 기준과 빈 회차 목록을 구분한다', () => {
    expect(writingStatus({ ...base, inherited: true })).toBe('원작 기준 · 읽기 전용')
    expect(writingStatus({ ...base, active: false })).toBe('회차를 만들어 주세요')
    expect(writingStatus({ ...base, ready: false })).toBe('회차를 불러오는 중…')
  })
})

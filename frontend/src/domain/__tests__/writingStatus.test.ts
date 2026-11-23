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
  it('자동·수동 저장 진행과 저장 실패를 일반 요청 상태와 구분한다', () => {
    expect(writingStatus({ ...base, saving: true, dirty: true })).toBe('저장 중…')
    expect(writingStatus({ ...base, saveError: '연결 실패', dirty: true })).toBe('저장 실패 · 입력은 화면에 남아 있어요')
  })
  it('저장 실패 뒤 입력을 저장본과 같게 되돌려 다시 시도할 입력이 없으면 입력이 남아 있다고 알리지 않는다', () => {
    // 재시도 버튼은 미저장 입력이 있을 때만 보이므로, 같은 조건에서만 '입력은 화면에 남아 있어요'를 쓴다.
    expect(writingStatus({ ...base, saveError: '연결 실패', error: '연결 실패', dirty: false })).toBe('처리 실패 · 안내를 확인해 주세요')
    expect(writingStatus({ ...base, saveError: '이전 저장 실패', dirty: false })).toBe('저장됨')
  })
  it('서버 저장 시각과 버전 번호를 표시하고 미저장 입력을 성공으로 표시하지 않는다', () => {
    const savedAt = '2026-11-16T06:00:00Z'
    expect(writingStatus({ ...base, savedAt, version: 3 })).toBe(`저장됨(${new Date(savedAt).toLocaleTimeString('ko-KR')}) · 버전 3`)
    expect(writingStatus({ ...base, savedAt, version: 3, dirty: true })).toBe('저장되지 않은 변경')
  })
})

/** 초안 유무와 원작 승계 상태를 저장 성공과 구분한다. */
export function writingStatus(state: {
  ready: boolean; busy: boolean; error: string; dirty: boolean
  active: boolean; hasDraft: boolean; inherited: boolean
}): string {
  if (!state.ready) return '회차를 불러오는 중…'
  if (state.busy) return '처리 중…'
  if (state.error) return '처리 실패 · 안내를 확인해 주세요'
  if (!state.active) return '회차를 만들어 주세요'
  if (state.inherited) return '원작 기준 · 읽기 전용'
  if (state.dirty) return '저장되지 않은 변경'
  if (!state.hasDraft) return '작업 초안 없음'
  return '저장됨'
}

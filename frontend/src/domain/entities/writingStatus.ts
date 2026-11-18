/** 초안 유무와 원작 승계 상태를 저장 성공과 구분한다. */
export function writingStatus(state: {
  ready: boolean; busy: boolean; error: string; dirty: boolean
  active: boolean; hasDraft: boolean; inherited: boolean
  saving?: boolean; saveError?: string; savedAt?: string | null; version?: number
}): string {
  if (!state.ready) return '회차를 불러오는 중…'
  if (state.saving) return '저장 중…'
  if (state.busy) return '처리 중…'
  // 재시도 버튼(미저장 입력이 있을 때만 보임)과 같은 조건이다. 입력을 저장본과 같게 되돌렸다면 남은 실패는 아래 처리 실패 안내가 맡는다.
  if (state.saveError && state.dirty) return '저장 실패 · 입력은 화면에 남아 있어요'
  if (state.error) return '처리 실패 · 안내를 확인해 주세요'
  if (!state.active) return '회차를 만들어 주세요'
  if (state.inherited) return '원작 기준 · 읽기 전용'
  if (state.dirty) return '저장되지 않은 변경'
  if (!state.hasDraft) return '작업 초안 없음'
  return `저장됨${state.savedAt ? `(${new Date(state.savedAt).toLocaleTimeString('ko-KR')})` : ''}${state.version ? ` · 버전 ${state.version}` : ''}`
}

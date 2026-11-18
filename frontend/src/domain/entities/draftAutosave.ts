import type { Draft } from './content'

/** 편집은 새 Draft 객체를 만든다. 실패한 그 입력만 멈추고, 이후 입력은 다시 시도한다. */
export function shouldAutoSave(state: {
  dirty: boolean; busy: boolean; inherited: boolean
  draft: Draft; failedDraft: Draft | null
}): boolean {
  return state.dirty && !state.busy && !state.inherited && state.draft !== state.failedDraft
}

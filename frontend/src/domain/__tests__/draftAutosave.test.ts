import { expect, it } from 'vitest'
import { shouldAutoSave } from '../entities/draftAutosave'

const draft = { title: '제목', body: '미저장 원고', revision: 3 }
const ready = { dirty: true, busy: false, inherited: false, draft, failedDraft: null }

it('실패한 입력은 반복 요청하지 않고 다음 편집 또는 명시적 재시도에서 다시 저장한다', () => {
  expect(shouldAutoSave(ready)).toBe(true)
  expect(shouldAutoSave({ ...ready, failedDraft: draft })).toBe(false)
  expect(shouldAutoSave({ ...ready, failedDraft: draft, draft: { ...draft, body: '추가 입력' } })).toBe(true)
})

it('요청 중 추가된 입력은 이전 입력의 실패 때문에 멈추지 않는다', () => {
  const sent = { ...draft, body: '전송한 입력' }
  expect(shouldAutoSave({ ...ready, failedDraft: sent })).toBe(true)
})

it('저장할 변경이 없거나 사용자 요청 중이거나 원작 기준이면 요청하지 않는다', () => {
  expect(shouldAutoSave({ ...ready, dirty: false })).toBe(false)
  expect(shouldAutoSave({ ...ready, busy: true })).toBe(false)
  expect(shouldAutoSave({ ...ready, inherited: true })).toBe(false)
})

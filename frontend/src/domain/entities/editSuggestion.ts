/** Content 수정 제안(계약 SuggestionResponse). 목업 데모의 InboxItem(feedback.ts)과 별개다. */
export type EditSuggestion = {
  id: string
  workId: string
  workTitle: string
  episodeNumber: number
  /** 제안을 올린 시점의 발행 버전. 이후 발행본이 바뀌어도 그대로다. */
  publishedVersionId: string
  source: 'reader' | 'ai'
  proposerName: string
  beforeText: string
  /** 제안자가 올린 원래 고친 문장. 작가가 편집해도 보존된다. */
  afterText: string
  /** 작가가 고쳐 저장한 편집안. 있으면 승인 내용은 이것이다. */
  editedText: string | null
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'held'
  decisionReason: string | null
  /** 승인 뒤 초안 반영 결과. 승인 상태와 따로 기록된다. */
  applyResult: 'applied' | 'failed' | null
  applyFailure: string | null
  appliedVersionId: string | null
  /** 범위 검사(표시 전용): auto는 자동 처리 가능한 표기 교정, review는 작가 검토 필요. */
  scope: 'auto' | 'review'
  scopeReasons: string[]
  mine: boolean
  owner: boolean
  createdAt: string
  updatedAt: string
}

/** 문장·편집안·사유의 최대 글자 수(공백 제거 후) */
export const SUGGESTION_MAX = 500

/** 사유(제안·거절)는 선택이며 500자 이하다. 통과하면 null. */
export const reasonError = (reason: string) => reason.trim().length > SUGGESTION_MAX ? `사유는 ${SUGGESTION_MAX}자까지 입력할 수 있어요.` : null

/** 등록 입력의 안내 문구(통과하면 null). 고칠 문장은 본문에서 고른 문장이라 비거나 500자를 넘으면 거절한다. */
export function suggestionInputError(beforeText: string, afterText: string, reason = '') {
  const before = beforeText.trim(), after = afterText.trim()
  if (!before) return '고칠 문장을 찾을 수 없어요. 본문에서 문장을 다시 골라 주세요.'
  if (before.length > SUGGESTION_MAX) return `선택한 문장이 ${SUGGESTION_MAX}자를 넘어 수정 제안할 수 없어요.`
  if (!after) return '고친 문장을 입력해 주세요.'
  if (after.length > SUGGESTION_MAX) return `고친 문장은 ${SUGGESTION_MAX}자까지 입력할 수 있어요.`
  if (after === before) return '고친 문장이 원래 문장과 같아요.'
  return reasonError(reason)
}

/** 작가의 편집안 입력의 안내 문구(통과하면 null) */
export function editedTextError(text: string) {
  const value = text.trim()
  if (!value) return '편집한 문장을 입력해 주세요.'
  if (value.length > SUGGESTION_MAX) return `편집한 문장은 ${SUGGESTION_MAX}자까지 입력할 수 있어요.`
  return null
}

/** 상태 칩: 승인 결과(초안 반영·반영 실패)는 승인 상태 뒤에 따로 보인다. tone은 진행 중(wait)·완료(ok)·종결(off)이다. */
export function suggestionStatus(s: Pick<EditSuggestion, 'status' | 'applyResult'>) {
  if (s.status === 'pending') return { label: '검토 대기', tone: 'wait' } as const
  if (s.status === 'held') return { label: '보류', tone: 'wait' } as const
  if (s.status === 'rejected') return { label: '거절됨', tone: 'off' } as const
  if (s.applyResult === 'applied') return { label: '승인됨 · 초안에 반영됨', tone: 'ok' } as const
  if (s.applyResult === 'failed') return { label: '승인됨 · 반영 실패', tone: 'wait' } as const
  return { label: '승인됨', tone: 'ok' } as const
}

/** 승인 요청 뒤 안내 문구. 초안 반영과 발행을 구분하고, 반영 실패를 완료로 안내하지 않는다. */
export function approvalNotice(s: Pick<EditSuggestion, 'applyResult'>) {
  if (s.applyResult === 'applied') return '승인했고 초안에 반영했어요 — 발행은 집필실에서 해 주세요.'
  if (s.applyResult === 'failed') return '승인은 기록했지만 초안에 반영하지 못했어요. 사유를 확인해 주세요.'
  return '승인했어요.'
}

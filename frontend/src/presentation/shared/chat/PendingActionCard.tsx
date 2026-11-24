import { useId, useState, type ReactNode } from 'react'

import { editableTexts, editedArgs, pendingChanges, worldProposalIsStale, type PendingAction, type WorldDraftRevision } from '../../../domain/entities/writingChat'

/** 저장되지 않은 편집이 있으면 승인할 수 없다는 안내(#554). 승인하면 서버의 저장본이 바뀌어 작성 중인 글과 어긋나기 때문이다. */
export const SAVE_FIRST = '먼저 저장해 주세요'
/** 카드를 찾을 수 없는 화면(집필실)의 카드 수정 승인 안내(#639). */
export const NO_BEFORE = '집필실에서는 수정 전 내용을 볼 수 없어요. 세계관 작업실에서 확인할 수 있어요.'
/** 작품 정보 수정 승인 안내(#687). 원고를 저장하면 작품 revision이 올라 이 제안이 낡고, 그때 AI는 바로 쓰지 않고 최신 revision으로 같은 수정의 승인 카드를 다시 띄운다. */
export const WORK_CHANGED_NOTE = '그사이 원고를 저장했다면 바로 반영하지 않고, 최신 작품 정보로 한 번 더 확인을 받아요.'

/**
 * 메인 에이전트가 Content 쓰기 도구를 실행하려고 승인을 기다리는 카드(#554). 모델의 요약이 아니라 실제로 실행할 도구와 인자를 보이고,
 * 설정 카드 수정이면 그 카드의 수정 전·후를 함께 보인다. 승인 전에는 아무것도 저장되지 않고, 거절하면 실행하지 않는다.
 * unsaved면(작성 중인 변경이 있으면) 승인 버튼을 막고 먼저 저장하라고 알린다.
 * children(같은 턴에 먼저 끝난 작업, #587)은 승인 판단의 자료라 제목 바로 아래에 둔다.
 * 고쳐서 승인(#795)은 이름·제목·설명·내용 같은 글 칸만 고쳐 그 인자로 실행한다. 식별자·revision은 보이지도 고치지도 않는다(AI가 다시 확인한다).
 */
export function PendingActionCard({ action, children, cardOf, unsaved = false, pending, worldDraft, onRefresh, onResume, onEdit }: {
  action: PendingAction
  children?: ReactNode
  cardOf?: (id: string) => { title: string; body: string } | undefined
  unsaved?: boolean
  worldDraft?: WorldDraftRevision
  pending: boolean
  onRefresh: () => void
  onResume: (approved: boolean) => void
  onEdit: (args: Record<string, unknown>) => void
}) {
  const id = useId()
  const [edits, setEdits] = useState<Record<string, string> | null>(null)
  const stale = worldProposalIsStale(action, worldDraft)
  const changes = stale ? [] : pendingChanges(action, cardOf)
  const texts = stale ? [] : editableTexts(action, cardOf)
  if (edits) {
    const blank = texts.some((t) => t.title && !(edits[t.key] ?? t.value).trim())
    return <form className="chat-hitl" aria-labelledby={`${id}-t`} onSubmit={(e) => { e.preventDefault(); if (!blank) onEdit(editedArgs(action, edits)) }}>
      <h3 id={`${id}-t`}>{action.label} 내용을 고쳐서 실행할까요?</h3>
      {children}
      {texts.map((t) => <label key={t.key} className="chat-field">{t.label}
        {t.title
          ? <input value={edits[t.key] ?? t.value} onChange={(e) => setEdits({ ...edits, [t.key]: e.target.value })} />
          : <textarea rows={4} value={edits[t.key] ?? t.value} onChange={(e) => setEdits({ ...edits, [t.key]: e.target.value })} />}
      </label>)}
      {blank && <p className="chat-note" role="alert">이름·제목은 비워 둘 수 없어요.</p>}
      <p className="chat-note">글만 고칠 수 있어요. 실행하면 고친 내용이 {action.tool === 'work_update' ? '작품 정보' : '초안'}에 반영돼요.</p>
      {unsaved && <p className="chat-note" role="alert">{SAVE_FIRST}. 작성 중인 변경을 저장한 뒤 제안을 확인해 주세요.</p>}
      <div className="chat-hitl-actions">
        <button type="submit" className="btn sm pri" disabled={pending || unsaved || blank}>고친 내용으로 실행</button>
        <button type="button" className="btn sm" disabled={pending} onClick={() => setEdits(null)}>고치지 않기</button>
      </div>
    </form>
  }
  return <section className="chat-hitl" aria-labelledby={`${id}-t`}>
    <h3 id={`${id}-t`}>{stale ? '저장한 초안이 바뀌었어요' : `${action.label}을(를) 실행할까요?`}</h3>
    {children}
    {!!changes.length && <ul className="chat-hitl-others" tabIndex={0} aria-label="바뀌는 내용">{changes.map((change, i) => <li key={i}>
      <span className="chat-step-name">{change.name}</span>
      {change.before !== null && <p>수정 전: {change.before}</p>}
      <p>수정 후: {change.after}</p>
    </li>)}</ul>}
    {!!changes.length && !cardOf && <p className="chat-note">{NO_BEFORE}</p>}
    {stale
      ? <p className="chat-note" role="status">현재 초안에 맞는 제안을 다시 받아 보세요. 이미 끝난 작업은 다시 실행하지 않아요.</p>
      : <>
        <div className="chat-hitl-preview chat-hitl-args" tabIndex={0} aria-label="실행할 도구와 인자"><code>{action.tool}</code>{'\n'}{JSON.stringify(action.args, null, 2)}</div>
        <p className="chat-note">실행을 누르면 이 내용이 {action.tool === 'work_update' ? '작품 정보' : '초안'}에 반영돼요. 실행하지 않기를 누르면 아무것도 바뀌지 않아요.</p>
        {action.tool === 'work_update' && <p className="chat-note">{WORK_CHANGED_NOTE}</p>}
      </>}
    {unsaved && <p className="chat-note" role="alert">{SAVE_FIRST}. 작성 중인 변경을 저장한 뒤 제안을 확인해 주세요.</p>}
    <div className="chat-hitl-actions">
      {stale
        ? <button type="button" className="btn sm pri" disabled={pending || unsaved} onClick={onRefresh}>저장한 초안으로 제안 다시 받기</button>
        : <button type="button" className="btn sm pri" disabled={pending || unsaved} onClick={() => onResume(true)}>실행</button>}
      {!!texts.length && <button type="button" className="btn sm" disabled={pending} onClick={() => setEdits({})}>고쳐서 승인</button>}
      <button type="button" className="btn sm" disabled={pending} onClick={() => onResume(false)}>실행하지 않기</button>
    </div>
  </section>
}

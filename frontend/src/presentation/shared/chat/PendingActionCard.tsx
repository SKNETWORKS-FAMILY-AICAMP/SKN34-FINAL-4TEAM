import { useId, type ReactNode } from 'react'

import { pendingChanges, worldProposalIsStale, type PendingAction, type WorldDraftRevision } from '../../../domain/entities/writingChat'

/** 저장되지 않은 편집이 있으면 승인할 수 없다는 안내(#554). 승인하면 서버의 저장본이 바뀌어 작성 중인 글과 어긋나기 때문이다. */
export const SAVE_FIRST = '먼저 저장해 주세요'

/**
 * 메인 에이전트가 Content 쓰기 도구를 실행하려고 승인을 기다리는 카드(#554). 모델의 요약이 아니라 실제로 실행할 도구와 인자를 보이고,
 * 설정 카드 수정이면 그 카드의 수정 전·후를 함께 보인다. 승인 전에는 아무것도 저장되지 않고, 거절하면 실행하지 않는다.
 * unsaved면(작성 중인 변경이 있으면) 승인 버튼을 막고 먼저 저장하라고 알린다.
 * children(같은 턴에 먼저 끝난 작업, #587)은 승인 판단의 자료라 제목 바로 아래에 둔다.
 */
export function PendingActionCard({ action, children, cardOf, unsaved = false, pending, worldDraft, onRefresh, onResume }: {
  action: PendingAction
  children?: ReactNode
  cardOf?: (id: string) => { title: string; body: string } | undefined
  unsaved?: boolean
  worldDraft?: WorldDraftRevision
  pending: boolean
  onRefresh: () => void
  onResume: (approved: boolean) => void
}) {
  const id = useId()
  const stale = worldProposalIsStale(action, worldDraft)
  const changes = stale ? [] : pendingChanges(action, cardOf)
  return <section className="chat-hitl" aria-labelledby={`${id}-t`}>
    <h3 id={`${id}-t`}>{stale ? '저장한 초안이 바뀌었어요' : `${action.label}을(를) 실행할까요?`}</h3>
    {children}
    {!!changes.length && <ul className="chat-hitl-others" tabIndex={0} aria-label="바뀌는 내용">{changes.map((change, i) => <li key={i}>
      <span className="chat-step-name">{change.name}</span>
      {change.before !== null && <p>수정 전: {change.before}</p>}
      <p>수정 후: {change.after}</p>
    </li>)}</ul>}
    {stale
      ? <p className="chat-note" role="status">현재 초안에 맞는 제안을 다시 받아 보세요. 이미 끝난 작업은 다시 실행하지 않아요.</p>
      : <>
        <div className="chat-hitl-preview chat-hitl-args" tabIndex={0} aria-label="실행할 도구와 인자"><code>{action.tool}</code>{'\n'}{JSON.stringify(action.args, null, 2)}</div>
        <p className="chat-note">실행을 누르면 이 내용이 초안에 반영돼요.</p>
      </>}
    {unsaved && <p className="chat-note" role="alert">{SAVE_FIRST}. 작성 중인 변경을 저장한 뒤 제안을 확인해 주세요.</p>}
    <div className="chat-hitl-actions">
      {stale
        ? <button type="button" className="btn sm pri" disabled={pending || unsaved} onClick={onRefresh}>저장한 초안으로 제안 다시 받기</button>
        : <button type="button" className="btn sm pri" disabled={pending || unsaved} onClick={() => onResume(true)}>실행</button>}
      <button type="button" className="btn sm" disabled={pending} onClick={() => onResume(false)}>실행하지 않기</button>
    </div>
  </section>
}

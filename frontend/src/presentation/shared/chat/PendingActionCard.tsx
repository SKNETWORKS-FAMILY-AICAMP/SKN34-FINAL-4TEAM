import { useId } from 'react'

import { pendingChanges, type PendingAction } from '../../../domain/entities/writingChat'

/** 저장되지 않은 편집이 있으면 승인할 수 없다는 안내(#554). 승인하면 서버의 저장본이 바뀌어 작성 중인 글과 어긋나기 때문이다. */
export const SAVE_FIRST = '먼저 저장해 주세요'

/**
 * 메인 에이전트가 Content 쓰기 도구를 실행하려고 승인을 기다리는 카드(#554). 모델의 요약이 아니라 실제로 실행할 도구와 인자를 보이고,
 * 설정 카드 수정이면 그 카드의 수정 전·후를 함께 보인다. 승인 전에는 아무것도 저장되지 않고, 거절하면 실행하지 않는다.
 * unsaved면(작성 중인 변경이 있으면) 승인 버튼을 막고 먼저 저장하라고 알린다.
 */
export function PendingActionCard({ action, cardOf, unsaved = false, pending, onResume }: {
  action: PendingAction
  cardOf?: (id: string) => { title: string; body: string } | undefined
  unsaved?: boolean
  pending: boolean
  onResume: (approved: boolean) => void
}) {
  const id = useId()
  const changes = pendingChanges(action, cardOf)
  return <section className="chat-hitl" aria-labelledby={`${id}-t`}>
    <h3 id={`${id}-t`}>{action.label}을(를) 실행할까요?</h3>
    {!!changes.length && <ul className="chat-hitl-others" tabIndex={0} aria-label="바뀌는 내용">{changes.map((change, i) => <li key={i}>
      <span className="chat-step-name">{change.name}</span>
      {change.before !== null && <p>수정 전: {change.before}</p>}
      <p>수정 후: {change.after}</p>
    </li>)}</ul>}
    <div className="chat-hitl-preview chat-hitl-args" tabIndex={0} aria-label="실행할 도구와 인자"><code>{action.tool}</code>{'\n'}{JSON.stringify(action.args, null, 2)}</div>
    <p className="chat-note">승인하기 전에는 아무것도 바뀌지 않아요. 승인하면 이 내용 그대로 저장하고, 거절하면 실행하지 않아요.</p>
    {unsaved && <p className="chat-note" role="alert">{SAVE_FIRST}. 작성 중인 변경이 있어 지금은 승인할 수 없어요. 저장하면 서버 초안이 바뀌어 이 제안은 오래된 내용이 되니, 저장한 뒤 같은 요청을 다시 보내 주세요.</p>}
    <div className="chat-hitl-actions">
      <button type="button" className="btn sm pri" disabled={pending || unsaved} onClick={() => onResume(true)}>실행</button>
      <button type="button" className="btn sm" disabled={pending} onClick={() => onResume(false)}>실행하지 않기</button>
    </div>
  </section>
}

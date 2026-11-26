import { useId, type Ref } from 'react'

import { replyOutcome } from '../../../domain/entities/writingChat'
import type { ProposalColumn } from './proposalView'
import type { ProposalStageViewModel } from './useProposalStageViewModel'
import type { ChatViewModel } from './useWritingChatViewModel'
import { ApprovalCard } from './WritingChat'
import './chat.css'
import './stage.css'

/** 비교 칸 하나. 강조 구간(mark)은 부분 수정이 바꾸는 글이다. */
function Column({ column }: { column: ProposalColumn }) {
  const id = useId()
  return <section className="stage-compare-col" aria-labelledby={id}>
    <p id={id} className="stage-compare-label">{column.label}</p>
    <div className="stage-compare-text" tabIndex={0}>{column.pre}{column.mark && <mark>{column.mark}</mark>}{column.post}</div>
  </section>
}

/**
 * 집필실 원고 영역의 집필 AI 제안 화면(#909, 모달 아님: 열려 있는 동안 편집기를 대신한다). 원고 반영 승인·후보 검수·계획 수정안을
 * 지금 초안(계획)과 나란히 보이고, 반영·다시 쓰기·반영하지 않기는 채팅 승인 카드(ApprovalCard)와 같은 요청을 보낸다.
 * 결과(반영함·반영 안 함·실패)와 오류는 채팅이 보이는 것과 같은 값(chat)을 그대로 보인다.
 * unsaved면 반영을 잠그고, 반영 회차가 열린 회차와 다르면 그 회차를 열어 비교하라고 안내한다(열린 회차로 대신하지 않는다).
 */
export function ProposalStage({ proposal, chat, unsaved, canOpenEpisode, onOpenEpisode, headingRef, onClose }: {
  proposal: ProposalStageViewModel; chat: ChatViewModel; unsaved: boolean; canOpenEpisode: boolean; onOpenEpisode: (episode: number) => void
  headingRef?: Ref<HTMLHeadingElement>; onClose: () => void
}) {
  const id = useId()
  const { view } = proposal
  const reply = chat.waiting
  const last = chat.turns.at(-1)?.reply
  const outcome = !chat.live && last ? replyOutcome(last) : []
  return <section className="stage proposal-stage" aria-labelledby={`${id}-h`}>
    <header className="stage-head">
      <h2 id={`${id}-h`} ref={headingRef} tabIndex={-1}>집필 AI 제안</h2>
      <button type="button" className="btn sm" onClick={onClose}>닫기</button>
    </header>
    {chat.error && <div className="chat-error" role="alert"><p>{chat.error}</p><button type="button" className="btn sm" onClick={chat.retry}>다시 불러오기</button></div>}
    {reply && view ? <>
      {view.notice && <div className="stage-proposal-notice">
        <p className="chat-note" role="status">{view.notice}</p>
        {view.openEpisode !== null && canOpenEpisode && <button type="button" className="btn sm" onClick={() => onOpenEpisode(view.openEpisode!)}>{view.openEpisode}화 열기</button>}
      </div>}
      <ApprovalCard reply={reply} pending={chat.pending} unsaved={unsaved && view.kind !== 'plan'} onRefreshProposal={() => void chat.refreshProposal()}
        onResume={(approved, inputs, pick) => void chat.resume(approved, inputs, pick)}
        compare={<div className="stage-compare">{view.current && <Column column={view.current} />}<Column column={view.proposal} /></div>} />
    </> : chat.live ? <p className="chat-note" role="status">요청을 처리하고 있어요…</p>
      : outcome.length ? outcome.map((line, i) => <p key={i} className="stage-result" role="status">{line}</p>)
        : <p className="chat-note">지금 정할 제안이 없어요.</p>}
  </section>
}

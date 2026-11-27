import { useEffect, useId, type RefObject } from 'react'

import { replyOutcome } from '../../../domain/entities/writingChat'
import { ManuscriptBody } from '../media/MediaPanel'
import type { ProposalColumn } from './proposalView'
import type { ProposalStageViewModel } from './useProposalStageViewModel'
import type { ChatViewModel } from './useWritingChatViewModel'
import { ApprovalCard } from './WritingChat'
import './chat.css'
import './stage.css'

/**
 * 비교 칸 하나. 강조 구간(mark)은 부분 수정이 바꾸는 글이거나 새 원고가 이어 붙는 글이다.
 * draft(새 원고)면 서식·이미지를 원고처럼 그린다: 붙는 글은 늘 \n\n 뒤 새 문단이라 앞 글(pre)과 붙는 글(mark)을 따로 그려도 이어 그린 것과 같다.
 * ponytail: 부분 수정(patch)·계획은 글자 그대로 그려 서식 기호가 보인다(구간 경계가 줄·서식 중간일 수 있어 ManuscriptBody로 쪼갤 수 없다).
 * 업그레이드: manuscriptBlocks 위에서 구간을 강조한다.
 */
function Column({ column, draft }: { column: ProposalColumn; draft?: { workId: string; episode: number } }) {
  const id = useId()
  const show = (text: string) => (draft ? <ManuscriptBody workId={draft.workId} number={draft.episode} body={text} /> : text)
  return <section className="stage-compare-col" aria-labelledby={id}>
    <p id={id} className="stage-compare-label">{column.label}</p>
    {/* 새 회차 첫 초안처럼 지금 초안이 비어 있으면 빈 칸 대신 무엇이 될지 알린다 */}
    {column.pre || column.mark || column.post
      ? <div className="stage-compare-text" tabIndex={0}>
        {column.pre && show(column.pre)}
        {column.mark && (draft ? <div className="stage-compare-added">{show(column.mark)}</div> : <mark>{column.mark}</mark>)}
        {column.post && show(column.post)}
      </div>
      : <p className="chat-note">아직 쓴 글이 없어요. 반영하면 오른쪽 글이 이 회차의 초안이 돼요.</p>}
  </section>
}

/**
 * 집필실 원고 영역의 집필 AI 제안 화면(#909, 모달 아님: 열려 있는 동안 편집기를 대신한다). 원고 반영 승인·후보 검수·계획 수정안을
 * 지금 초안(계획)과 나란히 보이고, 반영·다시 쓰기·반영하지 않기는 채팅 승인 카드(ApprovalCard)와 같은 요청을 보낸다.
 * 결과(반영함·반영 안 함·실패)와 오류는 채팅이 보이는 것과 같은 값(chat)을 그대로 보인다.
 * 결정(반영·반영하지 않기)을 보내면 누른 버튼이 결과 줄로 바뀌며 사라지므로, 결과 줄이 보일 때 초점이 body로 떨어져 있으면 제목으로 옮긴다(headingRef, #956).
 * 열린 회차가 반영 회차이고 그 회차에 저장하지 않은 편집(unsaved)이 있으면 반영을 잠그고(다른 회차의 편집은 aiApplied가 지키므로 잠그지 않는다), 반영 회차가 열린 회차와 다르면 그 회차를 열어 비교하라고 안내한다(열린 회차로 대신하지 않는다).
 */
export function ProposalStage({ proposal, chat, workId, unsaved, canOpenEpisode, onOpenEpisode, headingRef, onClose }: {
  proposal: ProposalStageViewModel; chat: ChatViewModel; workId: string; unsaved: boolean; canOpenEpisode: boolean; onOpenEpisode: (episode: number) => void
  headingRef?: RefObject<HTMLHeadingElement | null>; onClose: () => void
}) {
  const id = useId()
  const { view } = proposal
  const reply = chat.waiting
  const last = chat.turns.at(-1)?.reply
  const outcome = !chat.live && last ? replyOutcome(last) : []
  // 새 원고만 원고처럼 그린다(이미지는 반영 회차에서 읽는다). 반영 회차를 모르면 이미지를 읽을 곳이 없어 글자 그대로 둔다.
  const draft = view?.kind === 'draft' && view.episode !== null ? { workId, episode: view.episode } : undefined
  // 결과 줄이 그려지는 때(아래 마지막 갈래). 초점이 body로 떨어져 있을 때만 옮긴다: 그 사이 작가가 다른 곳(채팅 입력 등)으로 옮겼다면 빼앗지 않는다.
  const decided = !(reply && view) && outcome.length > 0
  useEffect(() => { if (decided && document.activeElement === document.body) headingRef?.current?.focus() }, [decided, headingRef])
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
      <ApprovalCard reply={reply} pending={chat.pending} unsaved={unsaved && view.kind !== 'plan' && view.episode !== null && view.openEpisode === null} onRefreshProposal={() => void chat.refreshProposal()}
        onResume={(approved, inputs, pick) => void chat.resume(approved, inputs, pick)}
        compare={<div className="stage-compare">{view.current && <Column column={view.current} draft={draft} />}<Column column={view.proposal} draft={draft} /></div>} />
    </> : chat.live ? <p className="chat-note" role="status">요청을 처리하고 있어요…</p>
      : outcome.length ? outcome.map((line, i) => <p key={i} className="stage-result" role="status">{line}</p>)
        : <p className="chat-note">지금 정할 제안이 없어요.</p>}
  </section>
}

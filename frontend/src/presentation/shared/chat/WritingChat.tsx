import { useId, useState } from 'react'

import { featureLabel, replyText, stepText, type ChatBasis, type ChatReply, type ChatStep, type ChatStepInputs } from '../../../domain/entities/writingChat'
import type { ChatMessage } from '../../../domain/entities/chat'
import { ComposeIcon, MoreIcon, SparkIcon } from '../icons'
import { PopMenu } from '../PopMenu'
import { ChatPanel } from './ChatPanel'
import { useWritingChatViewModel, type LiveTurn } from './useWritingChatViewModel'

const stateLabel = { done: '완료', run: '진행 중', wait: '대기', fail: '실패' } as const
const stepState = (step: ChatStep, running: string | null) =>
  step.status === 'failed' ? 'fail' : step.status === 'completed' ? 'done' : step.feature === running ? 'run' : 'wait'

/** 진행 중인 턴의 단계 목록. 단계가 끝나는 대로 결과를 바로 아래에 보인다(SSE 순서 그대로). */
function Progress({ live }: { live: LiveTurn }) {
  return <div className="chat-msg assistant">
    <span className="chat-avatar" aria-hidden="true"><SparkIcon size={16} /></span>
    <div className="chat-bubble chat-progress" role="status" aria-label="AI 진행 상황">
      <p className="chat-progress-title">{live.steps.length ? '작업을 순서대로 실행하고 있어요' : '요청을 살펴보고 있어요'}<span className="chat-dots" aria-hidden="true"><i /><i /><i /></span></p>
      {!!live.steps.length && <ol className="chat-steps">{live.steps.map((step, i) => {
        const state = stepState(step, live.running)
        const text = stepText(step)
        return <li key={`${step.feature}-${i}`} data-state={state}>
          <span className="chat-step-dot" aria-hidden="true" />
          <span className="chat-step-name">{featureLabel[step.feature] ?? step.feature}</span>
          <span className="chat-step-state">{stateLabel[state]}</span>
          {text && <p className="chat-step-text">{text}</p>}
        </li>
      })}</ol>}
    </div>
  </div>
}

/** 멈춘 턴: 초안 반영 승인 또는 빠진 단계 입력. 승인 전에는 원고가 바뀌지 않는다. */
function Waiting({ reply, episode, pending, onResume }: {
  reply: ChatReply; episode: number | null; pending: boolean; onResume: (approved: boolean, inputs?: ChatStepInputs) => void
}) {
  const id = useId()
  const [question, setQuestion] = useState('')
  const [plan, setPlan] = useState('')
  const draft = reply.steps.find((s) => s.feature === 'writing_editing' && s.status === 'completed')
  if (reply.awaitingApproval) {
    return <section className="chat-hitl" aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`}>{episode ? `${episode}화 초안에 반영할까요?` : '초안에 반영할까요?'}</h3>
      {draft && <div className="chat-hitl-preview" tabIndex={0} aria-label="반영할 내용">{stepText(draft)}</div>}
      <p className="chat-note">반영하면 작업 중인 초안만 바뀌고 발행되지 않아요. 반영하지 않아도 제안은 대화에 남아요.</p>
      <div className="chat-hitl-actions">
        <button type="button" className="btn sm pri" disabled={pending} onClick={() => onResume(true)}>초안에 반영</button>
        <button type="button" className="btn sm" disabled={pending} onClick={() => onResume(false)}>반영하지 않기</button>
      </div>
    </section>
  }
  const needs = reply.missingInputs
  const filled = needs.every((f) => (f === 'web_research' ? question.trim() : f === 'writing_editing' ? plan.trim() : false))
  const inputs: ChatStepInputs = {
    ...(needs.includes('web_research') ? { web_research: { question: question.trim() } } : {}),
    ...(needs.includes('writing_editing') && episode ? { writing_editing: { draft: { episodeNumber: episode, plan: plan.trim() } } } : {}),
  }
  return <form className="chat-hitl" aria-labelledby={`${id}-t`} onSubmit={(e) => { e.preventDefault(); if (filled) onResume(true, inputs) }}>
    <h3 id={`${id}-t`}>작업에 필요한 내용을 알려 주세요</h3>
    <p className="chat-note">{needs.map((f) => featureLabel[f] ?? f).join(' · ')} 단계가 입력을 기다려요. 취소하면 아무 작업도 실행하지 않아요.</p>
    {needs.includes('web_research') && <label className="chat-field">조사할 질문
      <input value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="예: 조선 후기 한양에서 동래까지 며칠 걸렸나요?" />
    </label>}
    {needs.includes('writing_editing') && <label className="chat-field">쓸 장면 계획{episode ? ` · ${episode}화` : ''}
      <textarea rows={3} value={plan} maxLength={4000} onChange={(e) => setPlan(e.target.value)} placeholder="예: 선장이 항구에 도착해 옛 동료와 마주친다." />
    </label>}
    {needs.some((f) => f !== 'web_research' && f !== 'writing_editing') && <p className="chat-note">이 단계의 입력은 아직 화면에서 채울 수 없어요. 취소한 뒤 다른 요청으로 보내 주세요.</p>}
    <div className="chat-hitl-actions">
      <button type="submit" className="btn sm pri" disabled={pending || !filled}>이어서 실행</button>
      <button type="button" className="btn sm" disabled={pending} onClick={() => onResume(false)}>취소</button>
    </div>
  </form>
}

/**
 * 집필 AI 채팅(#331): 세션 고르기·새 대화·제목 바꾸기·삭제, 메시지 수정·여기부터 지우기, SSE 진행과 승인·입력 대기.
 * 상태와 요청은 useWritingChatViewModel 하나가 맡고, 이 화면은 그 값을 그린다. AI 제안은 원고에 자동으로 반영되지 않는다.
 */
export function WritingChat({ workId, basis, emptyTitle, emptyText, suggestions, onApplied }: {
  workId: string | null; basis: ChatBasis | null; emptyTitle: string; emptyText: string; suggestions: string[]; onApplied?: (episode: number) => void
}) {
  const vm = useWritingChatViewModel(workId, basis, onApplied)
  const id = useId()
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const live = vm.live
  // 고치는 중이면 그 턴부터, 이어가는 중이면 멈춘 턴을 감추고 진행 표시로 대신한다.
  const shown = live?.editIndex !== undefined ? vm.turns.slice(0, live.editIndex) : live?.resumed ? vm.turns.slice(0, -1) : vm.turns
  const messages: ChatMessage[] = shown.flatMap((turn, i) => [
    { id: `u${i}`, role: 'user' as const, text: turn.request },
    ...(turn.reply && turn.reply.status !== 'waiting' ? [{ id: `a${i}`, role: 'assistant' as const, text: replyText(turn.reply) }] : []),
  ])
  if (live) messages.push({ id: 'live', role: 'user', text: live.request })
  const actions = (m: ChatMessage) => {
    if (m.role !== 'user' || m.id === 'live') return null
    const index = Number(m.id.slice(1))
    if (editing?.index === index) {
      return <form className="chat-edit" onSubmit={(e) => { e.preventDefault(); const text = editing.text.trim(); if (text) { setEditing(null); void vm.edit(index, text) } }}>
        <label className="sr-only" htmlFor={`${id}-edit`}>고칠 메시지</label>
        <textarea id={`${id}-edit`} rows={2} value={editing.text} maxLength={2000} autoFocus onChange={(e) => setEditing({ index, text: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null) }} />
        <div className="chat-hitl-actions">
          <button type="submit" className="btn sm pri" disabled={!editing.text.trim() || !!vm.lockedReason}>고쳐서 다시 보내기</button>
          <button type="button" className="btn sm" onClick={() => setEditing(null)}>취소</button>
        </div>
        <p className="chat-note">이 메시지 뒤의 대화는 지워지고 이 메시지부터 다시 실행해요.</p>
      </form>
    }
    if (vm.pending || live) return null
    return <div className="chat-msg-actions">
      <button type="button" onClick={() => setEditing({ index, text: m.text })} disabled={!!vm.lockedReason}>수정</button>
      <button type="button" onClick={() => void vm.deleteFrom(index)}>여기부터 지우기</button>
    </div>
  }
  const current = vm.sessions?.find((s) => s.threadId === vm.threadId)
  return <>
    <div className="chat-sessions">
      {renaming !== null ? <form className="chat-rename" onSubmit={async (e) => { e.preventDefault(); if (await vm.rename(renaming)) setRenaming(null) }}>
        <label className="sr-only" htmlFor={`${id}-title`}>대화 제목</label>
        <input id={`${id}-title`} value={renaming} maxLength={100} autoFocus onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null) }} />
        <button type="submit" className="btn sm pri" disabled={vm.pending || !renaming.trim()}>저장</button>
        <button type="button" className="btn sm" onClick={() => setRenaming(null)}>취소</button>
      </form> : confirming ? <div className="chat-rename" role="group" aria-label="대화 삭제 확인">
        <p>이 대화를 지울까요? 되돌릴 수 없어요.</p>
        <button type="button" className="btn sm danger" autoFocus disabled={vm.pending} onClick={async () => { if (await vm.remove()) setConfirming(false) }}>지우기</button>
        <button type="button" className="btn sm" onClick={() => setConfirming(false)}>취소</button>
      </div> : <>
        <label className="sr-only" htmlFor={`${id}-pick`}>대화 고르기</label>
        <select id={`${id}-pick`} className="chat-session-pick" value={vm.threadId ?? ''} disabled={!vm.available || !!live}
          onChange={(e) => (e.target.value ? vm.select(e.target.value) : vm.startNew())}>
          {(!vm.threadId || !current) && <option value="">{vm.threadId ? (vm.title || '새 대화') : '새 대화'}</option>}
          {vm.sessions?.map((s) => <option key={s.threadId} value={s.threadId}>{s.title || '제목 없음'}</option>)}
        </select>
        <button type="button" className="chat-icon-btn" aria-label="새 대화" title="새 대화" disabled={!vm.available || !!live} onClick={vm.startNew}><ComposeIcon /></button>
        <PopMenu className="chat-session-menu" label="대화 메뉴" icon={<MoreIcon />}>
          <button type="button" role="menuitem" disabled={!vm.threadId || !current || vm.pending || !!vm.waiting} onClick={() => setRenaming(vm.title)}>제목 바꾸기</button>
          <button type="button" role="menuitem" disabled={!vm.threadId || !current || vm.pending} onClick={() => setConfirming(true)}>대화 삭제</button>
          {!!vm.waiting && <p className="chat-note">승인·입력을 기다리는 동안은 제목을 바꿀 수 없어요.</p>}
        </PopMenu>
      </>}
    </div>
    <ChatPanel messages={messages} onSend={vm.send} busy={vm.pending} disabledReason={vm.lockedReason}
      emptyTitle={emptyTitle} emptyText={emptyText} suggestions={suggestions} renderActions={actions}
      after={live || vm.waiting || vm.error ? <>
        {live && <Progress live={live} />}
        {vm.waiting && <Waiting key={`${vm.threadId}-${vm.turns.length}`} reply={vm.waiting} episode={vm.basisEpisode} pending={vm.pending} onResume={(approved, inputs) => void vm.resume(approved, inputs)} />}
        {vm.error && <div className="chat-error" role="alert"><p>{vm.error}</p><button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button></div>}
      </> : undefined}
      composerTop={vm.available && <label className="chat-consent">
        <input type="checkbox" checked={vm.consent} onChange={(e) => vm.setConsent(e.target.checked)} />
        <span>질문과 발행 회차 일부를 OpenAI로 보내고 API 비용이 드는 데 동의해요.</span>
      </label>} />
  </>
}

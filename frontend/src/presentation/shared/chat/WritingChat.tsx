import { useId, useState } from 'react'

import { sceneLine, type CharacterSimulation } from '../../../domain/entities/characterSimulation'
import { checkAttachment, type ChatTurnAttachment } from '../../../domain/entities/chatAttachment'
import { draftNotice, featureLabel, PLAN_LABEL, referenceHref, replyOutcome, replyText, reviewCheckLabel, stepText, usedPlan, type ChatBasis, type ChatPage, type ChatReply, type ChatStep, type ChatStepInputs, type ReviewCheck, type WorldDraftRevision } from '../../../domain/entities/writingChat'
import type { ChatMessage } from '../../../domain/entities/chat'
import { ComposeIcon, MoreIcon, PencilIcon, SparkIcon, ThumbDownIcon, ThumbUpIcon, TrashIcon } from '../icons'
import { PopMenu } from '../PopMenu'
import { ChatPanel } from './ChatPanel'
import { PendingActionCard } from './PendingActionCard'
import { useEpisodeDraft } from './useEpisodeDraft'
import { useWritingChatViewModel, type ChatViewModel, type LiveTurn } from './useWritingChatViewModel'

const stateLabel = { done: '완료', run: '진행 중', wait: '대기', stop: '멈춤', fail: '실패', skip: '건너뜀' } as const
// 시뮬레이션 단계는 서버의 단계 상태가 아니라 장면 상태로 보인다: 진행 중 step은 완료로 오고, 멈춘 장면을 완료로 꾸미면 안 된다.
const simState = { running: 'run', paused: 'run', completed: 'done', stopped: 'stop', failed: 'fail' } as const
const stepState = (step: ChatStep, running: string[]) =>
  step.status === 'failed' ? 'fail' : step.status === 'skipped' ? 'skip' : step.simulation ? simState[step.simulation.status] : step.status === 'completed' ? 'done' : running.includes(step.feature) ? 'run' : 'wait'
/** 인물 시뮬레이션(#58) 입력 예시. 누르면 입력창에 글만 채운다. */
const attachmentsOf = (list?: ChatTurnAttachment[]) => (list?.length ? list.map((a, i) => ({ id: `${i}`, ...a })) : undefined) // 기록·진행 중 턴의 첨부(이름·종류) 칩. 비면 칩을 그리지 않는다.
const simulationExamples = ['IF 시뮬레이션: "만약 ~했다면?"', '흐름 시뮬레이션: 비트를 적어 요청']

/**
 * 채팅 쪽 장면 한 줄: 대본(턴·검사·승인)은 집필실 무대가 보이므로 채팅에는 상태와 턴 수만 알리고 무대를 여는 링크를 둔다.
 * 무대가 없는 화면(세계관 작업실)은 링크 대신 집필실에서 이어 갈 수 있다고 안내한다. 승인 대기여도 채팅에서 저장을 묻지 않는다.
 */
function SceneLine({ simulation, approval, onOpenStage }: { simulation: CharacterSimulation; approval?: boolean; onOpenStage?: () => void }) {
  return <div className="chat-sceneline">
    <p>{sceneLine(simulation)}{approval && ' · 원고 반영을 기다려요'}</p>
    {onOpenStage
      ? <button type="button" className="chat-link" onClick={onOpenStage}>무대 열기</button>
      : <p className="chat-note">시뮬레이션 무대는 집필실에서 열 수 있어요.</p>}
  </div>
}

/**
 * 플랫폼 조사(#547) 참고안: 세계관 · 카드 · 작가와 참고 이유. 카드는 새 탭에서 열어 채팅·작업 중인 화면을 지키고,
 * 다른 작가의 공개 설정이라 내 설정집에는 복사하지 않는다. 참고안이 없으면 링크 없이 stepText가 결과 없음을 알린다.
 */
function References({ step }: { step: ChatStep }) {
  const refs = step.result?.references
  if (step.status !== 'completed' || !refs?.length) return null
  return <ul className="chat-refs" aria-label="참고한 공개 설정">
    {refs.map((r) => <li key={`${r.worldId}-${r.cardId}`}>
      <a href={referenceHref(r)} target="_blank" rel="noreferrer">{r.worldName} · {r.cardTitle}</a> · {r.authorNickname}
      <p>{r.note}</p>
    </li>)}
    {step.result?.gaps?.map((g) => <li key={g} className="chat-note">확인 못 함: {g}</li>)}
  </ul>
}

/**
 * 진행 중인 턴의 단계 목록. 단계가 끝나는 대로 결과를 바로 아래에 보인다(SSE 순서 그대로).
 * 장면 한 줄은 상태 알림(role="status") 밖에 둔다: 알림 영역은 바뀔 때마다 통째로 읽혀 턴마다 다시 읽히기 때문이다.
 */
function Progress({ live, onOpenStage }: { live: LiveTurn; onOpenStage?: () => void }) {
  return <>
    <div className="chat-msg assistant">
      <span className="chat-avatar" aria-hidden="true"><SparkIcon size={16} /></span>
      <div className="chat-bubble chat-progress" role="status" aria-label="AI 진행 상황">
        <p className="chat-progress-title">{live.steps.length ? '작업을 실행하고 있어요' : '요청을 살펴보고 있어요'}<span className="chat-dots" aria-hidden="true"><i /><i /><i /></span></p>
        {!!live.steps.length && <ol className="chat-steps">{live.steps.map((step, i) => {
          const state = stepState(step, live.running)
          // 장면 카드가 그리는 단계는 한 줄 요약을 되풀이하지 않는다. 실패 사유는 그대로 보인다.
          const text = (step.simulation && step.status !== 'failed') || step.result?.references?.length ? '' : stepText(step)
          return <li key={`${step.feature}-${i}`} data-state={state}>
            <span className="chat-step-dot" aria-hidden="true" />
            <span className="chat-step-name">{featureLabel[step.feature] ?? step.feature}</span>
            <span className="chat-step-state">{stateLabel[state]}</span>
            {text && <p className="chat-step-text">{text}</p>}
            <References step={step} />
          </li>
        })}</ol>}
      </div>
    </div>
    {live.steps.map((step) => step.simulation && <div key={step.feature} className="chat-scene"><SceneLine simulation={step.simulation} onOpenStage={onOpenStage} /></div>)}
  </>
}

/**
 * 턴 사이 대기·승인 대기 중인 시뮬레이션 장면. 조작(재생·수정·원고 반영)은 무대에서 하고 채팅에는 한 줄만 둔다.
 * 장면을 읽지 못한 단계는 가짜 장면 없이 실패 사유만 보인다.
 */
function SceneWait({ reply, onOpenStage }: { reply: ChatReply; onOpenStage?: () => void }) {
  const step = reply.steps.find((s) => s.feature === 'character_simulation')
  return <div className="chat-scene">
    {step?.simulation
      ? <SceneLine simulation={step.simulation} approval={reply.awaitingApproval === 'character_simulation'} onOpenStage={onOpenStage} />
      : <p className="chat-note" role="alert">{step ? stepText(step) : '시뮬레이션 결과를 찾지 못했어요.'}</p>}
  </div>
}

/** 멈춘 턴: 초안 반영 승인(World 제안은 설정집 초안, #546) 또는 빠진 단계 입력. 승인 전에는 원고·설정집이 바뀌지 않는다. */
function Waiting({ workId, request, reply, episode, pending, onResume, onOpenStage, cardOf, unsaved, worldDraft, onRefreshProposal }: {
  workId: string; request: string; reply: ChatReply; episode: number | null; pending: boolean; onResume: (approved: boolean, inputs?: ChatStepInputs) => void; onOpenStage?: () => void
  cardOf?: (id: string) => { title: string; body: string } | undefined; unsaved?: boolean; worldDraft?: WorldDraftRevision; onRefreshProposal: () => void
}) {
  const id = useId()
  const [question, setQuestion] = useState('')
  const [plan, setPlan] = useState('')
  const [check, setCheck] = useState<ReviewCheck | null>(null)
  const [fix, setFix] = useState<number | null>(null)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [instruction, setInstruction] = useState('')
  const needs = reply.missingInputs
  // 조건부 수정(#370)은 새 원고 계획이 아니라 직전 검수의 확정 지적 중 고칠 하나를 고른다. 번호는 검수 결과 findings 순서다.
  const fixing = reply.steps.some((s) => s.feature === 'writing_editing' && s.when === 'if_issues_found')
  // 선택 구간 없는 부분 수정(#387 task=patch)은 반영 회차 초안에서 고칠 구간을 고른다(#497).
  const patching = !fixing && reply.steps.some((s) => s.feature === 'writing_editing' && s.task === 'patch')
  const source = useEpisodeDraft(workId, !reply.awaitingApproval && needs.includes('writing_editing') && patching ? episode : null)
  // World 제안(enrich)은 회차 원고가 아니라 설정집 초안에 반영한다(#546): 승인 대상 단계와 문구를 대기 기능으로 가른다. 읽지 못한(형식 오류) 제안은 보이지 않으므로 반영 버튼을 잠근다.
  const world = reply.awaitingApproval === 'world'
  // 계획 수정안(#578, task=revise_plan)도 회차 원고가 아니라 저장된 계획에 저장한다. 읽지 못한 제안은 world와 같이 저장 버튼을 잠근다.
  const revising = !world && reply.awaitingApproval === 'writing_editing' && reply.steps.some((s) => s.task === 'revise_plan')
  const draft = reply.steps.find((s) => s.feature === (world ? 'world' : 'writing_editing') && s.status === 'completed')
  const planLine = draft ? usedPlan(draft) : ''
  const notice = draft ? draftNotice(draft) : ''
  // 같은 턴에 끝난 다른 단계(심의 등급 등). 승인을 기다리는 동안 대기 응답은 메시지 목록에 없어 여기서만 보인다(#493).
  // 같은 턴의 후보 검수(#538)는 반영 여부를 정할 근거라 부가 작업 목록에 묻지 않고 미리보기 바로 아래에 따로 보인다.
  const candidateReview = reply.steps.find((s) => s.feature === 'manuscript_review' && s.status === 'completed' && s.manuscriptReview?.candidate)
  const others = reply.steps.filter((s) => s !== draft && s !== candidateReview && (s.status === 'completed' || s.status === 'failed'))
  if (reply.awaitingApproval === 'character_simulation' || reply.awaitingScene === 'character_simulation') return <SceneWait reply={reply} onOpenStage={onOpenStage} />
  // Content 쓰기 도구 승인(#554): 실제 도구·인자를 보인다. 실행할 인자를 읽지 못했으면 승인을 받을 수 없어 카드를 만들지 않는다.
  if (reply.awaitingApproval === 'content_action') {
    return reply.pendingAction
      ? <PendingActionCard action={reply.pendingAction} cardOf={cardOf} unsaved={unsaved} pending={pending} worldDraft={worldDraft} onRefresh={onRefreshProposal} onResume={(approved) => onResume(approved)} />
      : <p className="chat-note" role="alert">승인할 작업을 읽지 못했어요. 대화를 다시 불러와 주세요.</p>
  }
  if (reply.awaitingApproval) {
    return <section className="chat-hitl" aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`}>{world ? '이 제안을 설정집 초안에 반영할까요?' : revising ? (draft?.planRevision ? `'${draft.planRevision.before.title}' 계획에 저장할까요?` : '이 제안을 계획에 저장할까요?')
        : reply.approvalEpisode ? `${reply.approvalEpisode}화 초안에 반영할까요?` : '이 제안을 초안에 반영할까요?'}</h3>
      {draft && <div className="chat-hitl-preview" tabIndex={0} aria-label="반영할 내용">{stepText(draft)}</div>}
      {candidateReview && <div className="chat-hitl-preview" tabIndex={0} aria-label="후보 검수 결과">{stepText(candidateReview)}</div>}
      {planLine && <p className="chat-plan" tabIndex={0}><b>{PLAN_LABEL}</b>{planLine.slice(PLAN_LABEL.length)}</p>}
      {notice && <p className="chat-plan" tabIndex={0}>{notice}</p>}
      {!!others.length && <ul className="chat-hitl-others" tabIndex={0} aria-label="같이 끝난 작업">{others.map((s, i) => <li key={`${s.feature}-${i}`}>
        <span className="chat-step-name">{featureLabel[s.feature] ?? s.feature}</span><p>{stepText(s)}</p>
      </li>)}</ul>}
      <p className="chat-note">{world ? '반영하면 설정집 초안만 바뀌고 확정 버전은 남지 않아요.' : revising ? '저장하면 이 계획의 제목·내용만 바뀌고 원고 초안은 바뀌지 않아요.' : '반영하면 작업 중인 초안만 바뀌고 발행되지 않아요.'} {revising ? '저장하지' : '반영하지'} 않아도 제안은 대화에 남아요.</p>
      <div className="chat-hitl-actions">
        <button type="button" className="btn sm pri" disabled={pending || ((world || revising) && !draft)} onClick={() => onResume(true)}>{world ? '설정집 초안에 반영' : revising ? '계획에 저장' : '초안에 반영'}</button>
        <button type="button" className="btn sm" disabled={pending} onClick={() => onResume(false)}>{revising ? '저장하지 않기' : '반영하지 않기'}</button>
      </div>
    </section>
  }
  const reviewed = reply.steps.find((s) => s.feature === 'manuscript_review')
  const confirmed = (reviewed?.manuscriptReview?.findings ?? [])
    .flatMap((f, i) => (f.status === 'confirmed' ? [{ ...f, index: i }] : []))
  const wanted = (instruction.trim() || request).slice(0, 2000)
  // 글상자는 줄바꿈을 LF로 바꿔 보여 CRLF 초안의 위치가 서버 본문과 어긋나고, Content는 5,000자까지만 받는다.
  const crlf = !!source.draft?.body.includes(String.fromCharCode(13))
  const span = episode && source.draft && !crlf && range.end > range.start && range.end - range.start <= 5000 && wanted.trim()
    ? { episode, revision: source.draft.revision, start: range.start, end: range.end, instruction: wanted } : null
  const filled = needs.every((f) => (f === 'research' ? question.trim() : f === 'writing_editing' ? (fixing ? fix !== null : patching ? !!span : plan.trim()) : f === 'manuscript_review' ? check : false))
  const inputs: ChatStepInputs = {
    ...(needs.includes('research') ? { research: { question: question.trim() } } : {}),
    ...(needs.includes('manuscript_review') && check ? { manuscript_review: { check } } : {}),
    ...(needs.includes('writing_editing') && fixing && fix !== null ? { writing_editing: { fix } } : {}),
    ...(needs.includes('writing_editing') && patching && span ? { writing_editing: { span } } : {}),
    ...(needs.includes('writing_editing') && !fixing && !patching && episode ? { writing_editing: { draft: { episodeNumber: episode, plan: plan.trim() } } } : {}),
  }
  return <form className="chat-hitl" aria-labelledby={`${id}-t`} onSubmit={(e) => { e.preventDefault(); if (filled) onResume(true, inputs) }}>
    <h3 id={`${id}-t`}>작업에 필요한 내용을 알려 주세요</h3>
    <p className="chat-note">{needs.map((f) => featureLabel[f] ?? f).join(' · ')} 단계가 입력을 기다려요. 취소하면 아무 작업도 실행하지 않아요.</p>
    {needs.includes('research') && <label className="chat-field">조사할 질문
      <input value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="예: 조선 후기 한양에서 동래까지 며칠 걸렸나요?" />
    </label>}
    {/* 대기 중에는 검수 답이 채팅에 그려지지 않으므로 제안·의심 지적·확인 못 한 부분을 여기서 보인다(#391) */}
    {needs.includes('writing_editing') && fixing && reviewed && <div className="chat-hitl-preview" tabIndex={0} aria-label="검수 결과">{stepText(reviewed)}</div>}
    {needs.includes('writing_editing') && fixing && <fieldset className="chat-choice">
      <legend>고칠 지적{episode ? ` · ${episode}화 초안` : ''}</legend>
      {confirmed.map((f) => <label key={f.index}>
        <input type="radio" name={`${id}-fix`} checked={fix === f.index} onChange={() => setFix(f.index)} />
        "{f.quote}" — {f.reason}
      </label>)}
    </fieldset>}
    {needs.includes('writing_editing') && !fixing && !patching && <label className="chat-field">쓸 장면 계획{episode ? ` · ${episode}화` : ''}
      <textarea rows={3} value={plan} maxLength={4000} onChange={(e) => setPlan(e.target.value)} placeholder="예: 선장이 항구에 도착해 옛 동료와 마주친다." />
    </label>}
    {needs.includes('writing_editing') && patching && <>
      {!episode ? <p className="chat-note" role="alert">고칠 회차를 알 수 없어요. 취소한 뒤 집필실에서 회차를 열고 다시 요청해 주세요.</p>
        : source.status === 'failed' ? <div className="chat-error" role="alert"><p>{episode}화 초안을 읽지 못했어요.</p><button type="button" className="btn sm" onClick={source.retry}>다시 불러오기</button></div>
        : source.draft ? <label className="chat-field">수정할 초안 · {episode}화 (고칠 구간을 드래그해 고르세요)
          <textarea readOnly rows={8} value={source.draft.body} onSelect={(e) => setRange({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })} />
        </label> : <p className="chat-note" role="status">{episode}화 초안을 불러오고 있어요.</p>}
      {crlf && <p className="chat-note" role="alert">이 초안은 줄바꿈 형식(CRLF)이라 여기서 구간을 고를 수 없어요. 집필실에서 선택해 다시 요청해 주세요.</p>}
      {source.draft && <p className="chat-note">{range.end - range.start > 5000 ? '5,000자 이하로 골라 주세요.' : range.end > range.start ? `선택한 글 ${range.end - range.start}자` : '초안에서 고칠 구간을 골라 주세요.'}</p>}
      <label className="chat-field">수정 지시 (비우면 이번 요청 문장을 써요)
        <textarea rows={2} value={instruction} maxLength={2000} onChange={(e) => setInstruction(e.target.value)} placeholder="예: 말투를 더 차갑게 바꿔 주세요." />
      </label>
    </>}
    {needs.includes('manuscript_review') && <fieldset className="chat-choice">
      <legend>검수 종류{episode ? ` · ${episode}화 초안` : ''}</legend>
      {(['mechanical', 'semantic'] as const).map((c) => <label key={c}>
        <input type="radio" name={`${id}-check`} checked={check === c} onChange={() => setCheck(c)} />
        {reviewCheckLabel[c]}{c === 'semantic' && <span className="chat-note"> (연결된 세계관 설정과 대조)</span>}
      </label>)}
    </fieldset>}
    {(needs.some((f) => f !== 'research' && f !== 'writing_editing' && f !== 'manuscript_review')) && <p className="chat-note">이 단계의 입력은 아직 화면에서 채울 수 없어요. 취소한 뒤 다른 요청으로 보내 주세요.</p>}
    <div className="chat-hitl-actions">
      <button type="submit" className="btn sm pri" disabled={pending || !filled}>이어서 실행</button>
      <button type="button" className="btn sm" disabled={pending} onClick={() => onResume(false)}>취소</button>
    </div>
  </form>
}

/**
 * 집필 AI 채팅(#331): 세션 고르기·새 대화·제목 바꾸기·삭제, 메시지 수정·여기부터 지우기, SSE 진행과 승인·입력 대기.
 * 상태와 요청은 useWritingChatViewModel 하나가 맡고, 이 화면은 그 값을 그린다. AI 제안은 원고에 자동으로 반영되지 않는다.
 * 집필실은 무대(시뮬레이션)와 상태를 함께 쓰려고 ViewModel(chat)을 만들어 내려 주고, 그 밖의 화면은 basis·onApplied로 이 화면이 직접 만든다.
 * 인물 시뮬레이션 장면은 채팅에 상태 한 줄만 보이고 무대 열기(onOpenStage)로 집필실 무대를 연다.
 */
type WritingChatProps = {
  workId: string | null; emptyTitle: string; emptyText: string; suggestions: string[]; onOpenStage?: () => void
  chat?: ChatViewModel; basis?: ChatBasis | null; onApplied?: (episode: number) => void
  /** World 제안이 설정집 초안에 반영됐다(#546). 세계관 화면이 초안을 다시 읽는다. 집필실처럼 chat을 직접 만든 화면은 그 Hook에 넘긴다. */
  onWorldApplied?: () => void
  /** 새 메시지를 보내는 순간의 화면 정보(#554). 집필실처럼 chat을 직접 만든 화면은 그 Hook에 넘긴다. */
  getPage?: () => ChatPage | undefined
  /** Content 쓰기 도구 승인 카드가 설정 카드의 수정 전 값을 찾는 함수(세계관 화면)와, 작성 중인 변경이 있어 승인을 막아야 하는지. */
  cardOf?: (id: string) => { title: string; body: string } | undefined
  unsaved?: boolean
  worldDraft?: WorldDraftRevision
}

export function WritingChat({ chat, basis = null, onApplied, onWorldApplied, getPage, ...rest }: WritingChatProps) {
  return chat ? <WorkChat key={rest.workId} vm={chat} {...rest} /> : <OwnedChat key={rest.workId} basis={basis} onApplied={onApplied} onWorldApplied={onWorldApplied} getPage={getPage} {...rest} />
}

function OwnedChat({ basis, onApplied, onWorldApplied, getPage, ...rest }: Omit<WritingChatProps, 'chat'>) {
  const vm = useWritingChatViewModel(rest.workId, basis ?? null, onApplied, onWorldApplied, getPage)
  return <WorkChat vm={vm} {...rest} />
}

function WorkChat({ vm, workId, emptyTitle, emptyText, suggestions, onOpenStage, cardOf, unsaved, worldDraft }: { vm: ChatViewModel } & Pick<WritingChatProps, 'workId' | 'emptyTitle' | 'emptyText' | 'suggestions' | 'onOpenStage' | 'cardOf' | 'unsaved' | 'worldDraft'>) {
  const id = useId()
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const live = vm.live
  function selectConversation(id: string) {
    setEditing(null)
    if (id) vm.select(id)
    else vm.startNew()
  }
  // 고치는 중이면 그 턴부터, 이어가는 중이면 멈춘 턴을 감추고 진행 표시로 대신한다.
  const shown = live?.editIndex !== undefined ? vm.turns.slice(0, live.editIndex) : live?.resumed ? vm.turns.slice(0, -1) : vm.turns
  const messages: ChatMessage[] = shown.flatMap((turn, i) => [
    { id: `u${i}`, role: 'user' as const, text: turn.request, attachments: attachmentsOf(turn.attachments) },
    ...(turn.reply && turn.reply.status !== 'waiting' ? [{
      id: `a${i}`,
      role: 'assistant' as const,
      text: turn.reply.message || replyText(turn.reply),
      format: turn.reply.message ? 'markdown' as const : undefined,
      failed: turn.reply.status === 'failed' || turn.reply.status === 'rejected',
    }] : []),
  ])
  // 종합 답변이 있는 말풍선은 단계별 결과를 접어 둔다(답변과 같은 내용이 두 번 보이지 않게, #492). 승인 카드·진행 표시는 그대로다.
  // 좋아요·싫어요는 그 줄의 오른쪽(말풍선 오른쪽 아래)에 둔다.
  const stepDetails = (m: ChatMessage) => {
    if (m.role !== 'assistant') return null
    const reply = m.format === 'markdown' ? shown[Number(m.id.slice(1))]?.reply : undefined
    const text = reply ? replyText(reply) : ''
    const outcome = text && reply ? replyOutcome(reply) : []
    return <>
      {outcome.map((line, i) => <p key={i} className="chat-note">{line}</p>)}
      {reply?.steps.map((s, i) => <References key={`${s.feature}-${i}`} step={s} />)}
      <div className="chat-reply-foot">
        {text && <details className="chat-step-details"><summary>단계별 결과 보기</summary><p>{text}</p></details>}
        {/* shortcut: 좋아요·싫어요는 누른 값을 저장하지 않는다. 저장 위치·용도가 정해지면(#560) 연결한다. */}
        <div className="chat-msg-actions">
          <button type="button" aria-label="이 답변 좋아요" title="이 답변 좋아요"><ThumbUpIcon size={16} /></button>
          <button type="button" aria-label="이 답변 싫어요" title="이 답변 싫어요"><ThumbDownIcon size={16} /></button>
        </div>
      </div>
    </>
  }
  if (live) messages.push({ id: 'live', role: 'user', text: live.request, attachments: attachmentsOf(live.attachments) })
  const actions = (m: ChatMessage) => {
    if (m.role !== 'user' || m.id === 'live') return null
    const index = Number(m.id.slice(1))
    if (editing?.index === index) {
      return <form className="chat-edit" onSubmit={async (e) => { e.preventDefault(); const text = editing.text.trim(); if (text && await vm.edit(index, text)) setEditing(null) }}>
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
      <button type="button" onClick={() => setEditing({ index, text: m.text })} disabled={!!vm.lockedReason}
        aria-label="이 메시지 고치기" title="이 메시지 고치기"><PencilIcon size={16} /></button>
      <button type="button" onClick={() => void vm.deleteFrom(index)} aria-label="이 메시지부터 지우기" title="이 메시지부터 지우기"><TrashIcon size={16} /></button>
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
        <button type="button" className="btn sm danger" autoFocus disabled={vm.pending} onClick={async () => { if (await vm.remove()) { setEditing(null); setConfirming(false) } }}>지우기</button>
        <button type="button" className="btn sm" onClick={() => setConfirming(false)}>취소</button>
      </div> : <>
        <label className="sr-only" htmlFor={`${id}-pick`}>대화 고르기</label>
        <select id={`${id}-pick`} className="chat-session-pick" value={vm.threadId ?? ''} disabled={!vm.available || !!live}
          onChange={(e) => selectConversation(e.target.value)}>
          {(!vm.threadId || !current) && <option value="">{vm.threadId ? (vm.title || '새 대화') : '새 대화'}</option>}
          {vm.sessions?.map((s) => <option key={s.threadId} value={s.threadId}>{s.title || '제목 없음'}</option>)}
        </select>
        <button type="button" className="chat-icon-btn" aria-label="새 대화" title="새 대화" disabled={!vm.available || !!live} onClick={() => selectConversation("")}><ComposeIcon /></button>
        <PopMenu className="chat-session-menu" label="대화 메뉴" icon={<MoreIcon />}>
          <button type="button" role="menuitem" disabled={!vm.threadId || !current || vm.pending || !!vm.waiting} onClick={() => setRenaming(vm.title)}>제목 바꾸기</button>
          <button type="button" role="menuitem" disabled={!vm.threadId || !current || vm.pending} onClick={() => setConfirming(true)}>대화 삭제</button>
          {!!vm.waiting && <p className="chat-note">승인·입력을 기다리는 동안은 제목을 바꿀 수 없어요.</p>}
        </PopMenu>
      </>}
    </div>
    <ChatPanel messages={messages} onSend={(text, files) => vm.send(text, files.length ? { files } : undefined)} checkFile={checkAttachment} busy={vm.pending} disabledReason={vm.lockedReason} inputError={vm.inputError}
      emptyTitle={emptyTitle} emptyText={emptyText} suggestions={[...suggestions, ...simulationExamples]} renderCard={stepDetails} renderActions={actions}
      after={live || vm.waiting || vm.error ? <>
        {live && <Progress live={live} onOpenStage={onOpenStage} />}
        {vm.waiting && <Waiting key={`${vm.threadId}-${vm.turns.length}`} workId={workId ?? ''} request={vm.turns.at(-1)?.request ?? ''} reply={vm.waiting} episode={vm.targetEpisode} pending={vm.pending} onResume={(approved, inputs) => void vm.resume(approved, inputs)} onOpenStage={onOpenStage} cardOf={cardOf} unsaved={unsaved} worldDraft={worldDraft}
          onRefreshProposal={() => { const turn = vm.turns.at(-1); if (turn) void vm.edit(vm.turns.length - 1, turn.request) }} />}
        {vm.error && <div className="chat-error" role="alert"><p>{vm.error}</p><button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button></div>}
      </> : undefined} />
  </>
}

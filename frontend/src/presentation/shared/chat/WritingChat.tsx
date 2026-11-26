import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { sceneLine, type CharacterSimulation } from '../../../domain/entities/characterSimulation'
import { checkAttachment, type ChatTurnAttachment } from '../../../domain/entities/chatAttachment'
import { cancelNotice, draftNotice, featureLabel, fixLabel, PLAN_LABEL, rangePreview, referenceHref, replyChoices, replyOutcome, replyText, reviewCheckLabel, stepName, stepText, usedPlan, type ApprovalPick, type ChatActivity, type ChatBasis, type ChatPage, type ChatReply, type ChatStep, type ChatStepInputs, type ReviewCheck, type WorldDraftRevision } from '../../../domain/entities/writingChat'
import type { ChatMessage } from '../../../domain/entities/chat'
import { ComposeIcon, MoreIcon, PencilIcon, SparkIcon, ThumbDownIcon, ThumbUpIcon, TrashIcon } from '../icons'
import { PopMenu } from '../PopMenu'
import { CardMarkdown } from '../CardMarkdown'
import { ChatPanel } from './ChatPanel'
import { keepFiles } from './keepFiles'
import { PendingActionCard, SAVE_FIRST } from './PendingActionCard'
import { proposalLine, proposalStageView, type ProposalView } from './proposalView'
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
      <a href={referenceHref(r)} target="_blank" rel="noreferrer">{r.worldName} · {r.cardTitle}<span className="sr-only"> (새 탭에서 열림)</span></a> · {r.authorNickname}
      <p>{r.note}</p>
    </li>)}
    {step.result?.gaps?.map((g, i) => <li key={`${i}-${g}`} className="chat-note">확인 못 함: {g}</li>)}
  </ul>
}

const activityState = { running: 'run', done: 'done', failed: 'fail' } as const
/**
 * 진행 목록(#784): 판정·Content 도구·검색처럼 지금 하고 있는 작업 한 줄씩. 대상(회차·카드 이름·검색어)은 이름 뒤에 흐리게 붙인다.
 * 끝난 턴(finished)에 남은 running 줄은 결과를 모르고 끊긴 것이라 진행 중이 아니라 멈춤으로 보인다.
 */
function Activities({ list, finished }: { list: ChatActivity[]; finished?: boolean }) {
  return <ol className="chat-steps chat-activities" aria-label="AI 작업 목록">{list.map((a) => {
    const state = finished && a.status === 'running' ? 'stop' : activityState[a.status]
    return <li key={a.id} data-state={state}>
      <span className="chat-step-dot" aria-hidden="true" />
      <span className="chat-step-name">{a.label}{a.target && <span className="chat-activity-target">{a.target}</span>}</span>
      <span className="chat-step-state">{stateLabel[state]}</span>
    </li>
  })}</ol>
}

/**
 * 진행 중인 턴의 단계 목록. 단계가 끝나는 대로 결과를 바로 아래에 보인다(SSE 순서 그대로).
 * 장면 한 줄은 상태 알림(role="status") 밖에 둔다: 알림 영역은 바뀔 때마다 통째로 읽혀 턴마다 다시 읽히기 때문이다.
 * 쓰는 중인 답(#618)도 밖에 두고 aria-live를 끈다: 조각마다 읽지 않고 완성된 답이 대화에 들어올 때 한 번 읽힌다.
 * 진행 목록(#784)은 줄마다 자주 바뀌어 알림 영역 안에서도 읽지 않는다(aria-live=off). 제목 줄이 진행을 알린다.
 */
function Progress({ live, onOpenStage }: { live: LiveTurn; onOpenStage?: () => void }) {
  return <>
    <div className="chat-msg assistant">
      <span className="chat-avatar" aria-hidden="true"><SparkIcon size={16} /></span>
      <div className="chat-bubble chat-progress" role="status" aria-label="AI 진행 상황">
        <p className="chat-progress-title">{live.answer ? '답변을 쓰고 있어요' : live.steps.length ? '작업을 실행하고 있어요' : '요청을 살펴보고 있어요'}<span className="chat-dots" aria-hidden="true"><i /><i /><i /></span></p>
        {!!live.steps.length && <ol className="chat-steps">{live.steps.map((step, i) => {
          const state = stepState(step, live.running)
          // 장면 카드가 그리는 단계는 한 줄 요약을 되풀이하지 않는다. 실패 사유는 그대로 보인다.
          const text = (step.simulation && step.status !== 'failed') || step.result?.references?.length ? '' : stepText(step)
          return <li key={`${step.feature}-${i}`} data-state={state}>
            <span className="chat-step-dot" aria-hidden="true" />
            <span className="chat-step-name">{stepName(step)}</span>
            <span className="chat-step-state">{stateLabel[state]}</span>
            {text && <p className="chat-step-text">{text}</p>}
            <References step={step} />
          </li>
        })}</ol>}
        {!!live.activities.length && <div aria-live="off"><Activities list={live.activities} /></div>}
      </div>
    </div>
    {live.steps.map((step) => step.simulation && <div key={step.feature} className="chat-scene"><SceneLine simulation={step.simulation} onOpenStage={onOpenStage} /></div>)}
    {live.answer && <div className="chat-msg assistant chat-writing" aria-live="off">
      <span className="chat-avatar" aria-hidden="true"><SparkIcon size={16} /></span>
      <div className="chat-bubble"><div className="chat-text chat-md"><CardMarkdown text={live.answer} /></div></div>
    </div>}
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

/** 승인·입력 대기 카드 안의 같은 턴에 먼저 끝난 단계 목록(#493·#587·#661). */
function FinishedSteps({ steps }: { steps: ChatStep[] }) {
  if (!steps.length) return null
  return <>
    <p className="chat-note" aria-hidden="true">같이 끝난 작업</p>
    <ul className="chat-hitl-others" tabIndex={0} aria-label="같이 끝난 작업">{steps.map((s, i) => <li key={`${s.feature}-${i}`}>
      <span className="chat-step-name">{stepName(s)}</span>
      {/* AI가 정한 계획·확인 못 함 알림은 긴 원고 제안이 160px 창을 채워도 가려지지 않게 본문 앞에 둔다(replyText와 같은 줄). */}
      {s.status === 'completed' && [usedPlan(s), draftNotice(s)].filter(Boolean).map((line) => <p key={line}>{line}</p>)}
      {/* 참고안은 아래 링크 목록이 같은 내용을 보이므로 글로 되풀이하지 않는다(#640). */}
      {!(s.status === 'completed' && s.result?.references?.length) && <p>{stepText(s)}</p>}
      <References step={s} />
    </li>)}</ul>
  </>
}

type ApprovalResume = (approved: boolean, inputs?: ChatStepInputs, pick?: ApprovalPick) => void

/** 원고 영역으로 옮긴 승인 제안(#909)의 채팅 쪽 한 줄: 제안은 집필실 원고 영역에서 읽고 정한다. 링크를 누른 버튼을 알려 닫을 때 초점이 돌아오게 한다. */
function ProposalLine({ view, onOpen }: { view: ProposalView; onOpen: (opener: HTMLElement) => void }) {
  return <div className="chat-scene"><div className="chat-sceneline">
    <p>{proposalLine(view)}</p>
    <button type="button" className="chat-link" onClick={(e) => onOpen(e.currentTarget)}>원고 영역에서 보기</button>
  </div></div>
}

/**
 * 승인 카드: 초안 반영 승인(World 제안은 설정집 초안, #546, 계획 수정안은 계획, #578). 채팅 카드와 집필실 원고 영역(ProposalStage)이 함께 쓴다.
 * compare가 있으면 작은 미리보기 대신 그 비교 화면을 보인다. unsaved면 먼저 저장하라고 알리고 반영을 잠근다(Content 작업 승인 카드와 같다).
 * #795: 원고 반영 대기는 같은 요청으로 다시 쓰고(남은 횟수만큼), World 제안이 여럿이면 반영할 칸을 고른다.
 */
export function ApprovalCard({ reply, pending, unsaved = false, compare, onResume, onRefreshProposal }: {
  reply: ChatReply; pending: boolean; unsaved?: boolean; compare?: ReactNode; onResume: ApprovalResume; onRefreshProposal: () => void
}) {
  const id = useId()
  const [dropped, setDropped] = useState<number[]>([]) // World 제안 중 반영하지 않기로 뺀 번호(#795). 기본은 모두 반영한다
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
  const others = reply.steps.filter((s) => (s.status === 'completed' || s.status === 'failed') && s !== draft && s !== candidateReview)
  // World 제안이 여럿이면 칸마다 반영할지 고른다(#795). 모두 고르면 번호 없이 승인한다(전체 반영과 같다).
  const proposals = world && draft?.world?.task === 'enrich' ? draft.world.fixes : []
  const picked = proposals.map((_, i) => i).filter((i) => !dropped.includes(i))
  const partial = proposals.length > 1 && picked.length < proposals.length
  return <section className="chat-hitl" aria-labelledby={`${id}-t`}>
    <h3 id={`${id}-t`}>{world ? '이 제안을 설정집 초안에 반영할까요?' : revising ? (draft?.planRevision ? `'${draft.planRevision.before.title}' 계획에 저장할까요?` : '이 제안을 계획에 저장할까요?')
      : reply.approvalEpisode ? `${reply.approvalEpisode}화 초안에 반영할까요?` : '이 제안을 초안에 반영할까요?'}</h3>
    {compare ?? (draft && <div className="chat-hitl-preview" tabIndex={0} aria-label="반영할 내용">{stepText(draft)}</div>)}
    {proposals.length > 1 && <fieldset className="chat-choice">
      <legend>반영할 제안</legend>
      {proposals.map((f, i) => <label key={i}>
        <input type="checkbox" checked={!dropped.includes(i)} onChange={() => setDropped(dropped.includes(i) ? dropped.filter((d) => d !== i) : [...dropped, i])} />
        {fixLabel(f, proposals)}
      </label>)}
    </fieldset>}
    {candidateReview && <div className="chat-hitl-preview" tabIndex={0} aria-label="후보 검수 결과">{stepText(candidateReview)}</div>}
    {planLine && <p className="chat-plan" tabIndex={0}><b>{PLAN_LABEL}</b>{planLine.slice(PLAN_LABEL.length)}</p>}
    {notice && <p className="chat-plan" tabIndex={0}>{notice}</p>}
    <FinishedSteps steps={others} />
    <p className="chat-note">{world ? '반영하면 설정집 초안만 바뀌고 확정 버전은 남지 않아요.' : revising ? '저장하면 이 계획의 제목·내용만 바뀌고 원고 초안은 바뀌지 않아요.' : '반영하면 작업 중인 초안만 바뀌고 발행되지 않아요.'} {revising ? '저장하지' : '반영하지'} 않아도 제안은 대화에 남아요.</p>
    {unsaved && <p className="chat-note" role="alert">{SAVE_FIRST}. 작성 중인 변경을 저장한 뒤 제안을 확인해 주세요.</p>}
    <div className="chat-hitl-actions">
      <button type="button" className="btn sm pri" disabled={pending || unsaved || ((world || revising) && !draft) || (partial && !picked.length)}
        onClick={() => onResume(true, undefined, partial ? { selected: picked } : undefined)}>{world ? `${partial ? `고른 ${picked.length}개 ` : ''}설정집 초안에 반영` : revising ? '계획에 저장' : '초안에 반영'}</button>
      {/* 다시 쓰기(#795): 반영하지 않고 같은 요청으로 새 결과를 받는다. 서버가 남은 횟수를 줄 때만 보이고 다 쓰면 잠근다. */}
      {typeof reply.rewritesLeft === 'number' && !world && !revising
        && <button type="button" className="btn sm" disabled={pending || reply.rewritesLeft <= 0} onClick={onRefreshProposal}>다시 쓰기 ({reply.rewritesLeft}번 남음)</button>}
      <button type="button" className="btn sm" disabled={pending} onClick={() => onResume(false)}>{revising ? '저장하지 않기' : '반영하지 않기'}</button>
    </div>
  </section>
}

/**
 * 멈춘 턴: 초안 반영 승인(ApprovalCard) 또는 빠진 단계 입력. 승인 전에는 원고·설정집이 바뀌지 않는다.
 * onOpenProposal이 있으면(집필실) 원고 영역으로 옮길 승인 제안은 한 줄과 링크만 남긴다(#909).
 * #795: 원고 반영 대기는 같은 요청으로 다시 쓰고(남은 횟수만큼), World 제안이 여럿이면 반영할 칸을 고르며, 조건부 수정은 지적을 여럿 고른다.
 */
function Waiting({ workId, request, reply, pending, onResume, onOpenStage, onOpenProposal, cardOf, unsaved, worldDraft, onRefreshProposal }: {
  workId: string; request: string; reply: ChatReply; pending: boolean; onResume: ApprovalResume; onOpenStage?: () => void; onOpenProposal?: (opener: HTMLElement) => void
  cardOf?: (id: string) => { title: string; body: string } | undefined; unsaved?: boolean; worldDraft?: WorldDraftRevision; onRefreshProposal: () => void
}) {
  const id = useId()
  const [question, setQuestion] = useState('')
  const [plan, setPlan] = useState('')
  const [check, setCheck] = useState<ReviewCheck | null>(null)
  const [fixes, setFixes] = useState<number[]>([])
  const [range, setRange] = useState({ start: 0, end: 0, text: '' })
  const [instruction, setInstruction] = useState('')
  const needs = reply.missingInputs
  // 입력은 열린 회차가 아니라 멈춘 턴의 반영 회차에 대한 것이다(#635). 모르면 열린 회차로 대신하지 않는다.
  const episode = reply.approvalEpisode ?? null
  // 조건부 수정(#370)은 새 원고 계획이 아니라 직전 검수의 확정 지적 중 고칠 것을 고른다(여럿이면 한 수정안, #795). 번호는 검수 결과 findings 순서다.
  const fixing = reply.steps.some((s) => s.feature === 'writing_editing' && s.when === 'if_issues_found')
  // 선택 구간 없는 부분 수정(#387 task=patch)은 반영 회차 초안에서 고칠 구간을 고른다(#497).
  const patching = !fixing && reply.steps.some((s) => s.feature === 'writing_editing' && s.task === 'patch')
  const source = useEpisodeDraft(workId, !reply.awaitingApproval && needs.includes('writing_editing') && patching ? episode : null)
  // 초안은 카드가 뜬 뒤에 도착해 카드가 길어진다. 이어서 실행이 첫 화면 아래에 접혀 숨지 않게 버튼 줄이 보이도록 한 번 맞춘다(scrollIntoView가 없는 jsdom에서는 건너뛴다).
  const actions = useRef<HTMLDivElement>(null)
  const drafted = !!source.draft
  useEffect(() => { if (drafted) actions.current?.scrollIntoView?.({ block: 'nearest' }) }, [drafted])
  const finished = reply.steps.filter((s) => s.status === 'completed' || s.status === 'failed')
  if (reply.awaitingApproval === 'character_simulation' || reply.awaitingScene === 'character_simulation') return <SceneWait reply={reply} onOpenStage={onOpenStage} />
  // Content 쓰기 도구 승인(#554): 실제 도구·인자를 보인다. 실행할 인자를 읽지 못했으면 승인을 받을 수 없어 카드를 만들지 않는다.
  if (reply.awaitingApproval === 'content_action') {
    return reply.pendingAction
      ? <PendingActionCard action={reply.pendingAction} cardOf={cardOf} unsaved={unsaved} pending={pending} worldDraft={worldDraft} onRefresh={onRefreshProposal}
        onResume={(approved) => onResume(approved)} onEdit={(edited) => onResume(true, undefined, { edited })}>
        {/* 승인 대상이 Content 작업이라 원고 제안·후보 검수도 앞 단계다(빼지 않는다). */}
        <FinishedSteps steps={finished} />
      </PendingActionCard>
      : <p className="chat-note" role="alert">승인할 작업을 읽지 못했어요. 대화를 다시 불러와 주세요.</p>
  }
  if (reply.awaitingApproval) {
    const view = onOpenProposal ? proposalStageView(reply, null) : null
    if (view && onOpenProposal) return <ProposalLine view={view} onOpen={onOpenProposal} />
    return <ApprovalCard reply={reply} pending={pending} onResume={onResume} onRefreshProposal={onRefreshProposal} />
  }
  const reviewed = reply.steps.find((s) => s.feature === 'manuscript_review')
  // 조건부 수정은 검수 결과를 아래에 따로 보이므로 끝난 작업 목록에서 뺀다.
  const preview = needs.includes('writing_editing') && fixing ? reviewed : undefined
  const confirmed = (reviewed?.manuscriptReview?.findings ?? [])
    .flatMap((f, i) => (f.status === 'confirmed' ? [{ ...f, index: i }] : []))
  const picked = rangePreview(range.text)
  const wanted = (instruction.trim() || request).slice(0, 2000)
  // 글상자는 줄바꿈을 LF로 바꿔 보여 CRLF 초안의 위치가 서버 본문과 어긋나고, Content는 5,000자까지만 받는다.
  const crlf = !!source.draft?.body.includes('\r')
  const span = episode && source.draft && !crlf && range.end > range.start && range.end - range.start <= 5000 && wanted.trim()
    ? { episode, revision: source.draft.revision, start: range.start, end: range.end, instruction: wanted } : null
  const filled = needs.every((f) => (f === 'research' ? question.trim() : f === 'writing_editing' ? (fixing ? fixes.length > 0 : patching ? !!span : episode && plan.trim()) : f === 'manuscript_review' ? check : false))
  const inputs: ChatStepInputs = {
    ...(needs.includes('research') ? { research: { question: question.trim() } } : {}),
    ...(needs.includes('manuscript_review') && check ? { manuscript_review: { check } } : {}),
    ...(needs.includes('writing_editing') && fixing && fixes.length ? { writing_editing: { fix: [...fixes].sort((a, b) => a - b) } } : {}),
    ...(needs.includes('writing_editing') && patching && span ? { writing_editing: { span } } : {}),
    ...(needs.includes('writing_editing') && !fixing && !patching && episode ? { writing_editing: { draft: { episodeNumber: episode, plan: plan.trim() } } } : {}),
  }
  return <form className="chat-hitl" aria-labelledby={`${id}-t`} onSubmit={(e) => { e.preventDefault(); if (filled) onResume(true, inputs) }}>
    <h3 id={`${id}-t`}>작업에 필요한 내용을 알려 주세요</h3>
    <FinishedSteps steps={finished.filter((s) => s !== preview)} />
    <p className="chat-note">{needs.map((f) => featureLabel[f] ?? f).join(' · ')} 단계가 입력을 기다려요. {cancelNotice(reply)}</p>
    {needs.includes('research') && <label className="chat-field">조사할 질문
      <input value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="예: 조선 후기 한양에서 동래까지 며칠 걸렸나요?" />
    </label>}
    {/* 대기 중에는 검수 답이 채팅에 그려지지 않으므로 제안·의심 지적·확인 못 한 부분을 여기서 보인다(#391) */}
    {preview && <div className="chat-hitl-preview" tabIndex={0} aria-label="검수 결과">{stepText(preview)}</div>}
    {needs.includes('writing_editing') && fixing && <fieldset className="chat-choice">
      <legend>고칠 지적{episode ? ` · ${episode}화 초안` : ''}</legend>
      {confirmed.map((f) => <label key={f.index}>
        <input type="checkbox" checked={fixes.includes(f.index)} onChange={() => setFixes(fixes.includes(f.index) ? fixes.filter((n) => n !== f.index) : [...fixes, f.index])} />
        "{f.quote}" — {f.reason}
      </label>)}
    </fieldset>}
    {needs.includes('writing_editing') && !fixing && !patching && <label className="chat-field">쓸 장면 계획{episode ? ` · ${episode}화` : ''}
      <textarea rows={3} value={plan} maxLength={4000} onChange={(e) => setPlan(e.target.value)} placeholder="예: 선장이 항구에 도착해 옛 동료와 마주친다." />
    </label>}
    {needs.includes('writing_editing') && !fixing && !episode && <p className="chat-note" role="alert">고칠 회차를 알 수 없어요. 취소한 뒤 집필실에서 회차를 열고 다시 요청해 주세요.</p>}
    {needs.includes('writing_editing') && patching && <>
      {!episode ? null
        : source.status === 'failed' ? <div className="chat-error" role="alert"><p>{episode}화 초안을 읽지 못했어요.</p><button type="button" className="btn sm" onClick={source.retry}>다시 불러오기</button></div>
        : source.draft ? <label className="chat-field">수정할 초안 · {episode}화 (고칠 구간을 드래그해 고르세요)
          <textarea readOnly rows={8} value={source.draft.body} onSelect={(e) => { const { selectionStart: start, selectionEnd: end, value } = e.currentTarget; setRange({ start, end, text: value.slice(start, end) }) }} />
        </label> : <p className="chat-note" role="status">{episode}화 초안을 불러오고 있어요.</p>}
      {crlf && <p className="chat-note" role="alert">이 초안은 줄바꿈 형식(CRLF)이라 여기서 구간을 고를 수 없어요. 집필실에서 선택해 다시 요청해 주세요.</p>}
      {source.draft && <p className="chat-note">{range.end - range.start > 5000 ? '5,000자 이하로 골라 주세요.' : range.end > range.start ? `선택한 글 ${range.end - range.start}자${picked ? ` · “${picked}”` : ''}` : '초안에서 고칠 구간을 골라 주세요.'}</p>}
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
    <div ref={actions} className="chat-hitl-actions">
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
  /** 원고 영역으로 옮길 승인 제안(#909)을 여는 집필실의 함수. opener는 누른 링크라 닫을 때 초점이 돌아온다. 없으면(세계관 작업실 등) 승인 카드 전체를 채팅에 보인다. */
  onOpenProposal?: (opener: HTMLElement) => void
  chat?: ChatViewModel; basis?: ChatBasis | null; onApplied?: (episode: number) => void
  /** World 제안이 설정집 초안에 반영됐다(#546). 세계관 화면이 초안을 다시 읽는다. 집필실처럼 chat을 직접 만든 화면은 그 Hook에 넘긴다. */
  onWorldApplied?: () => void
  /** 새 메시지를 보내는 순간의 화면 정보(#554). 집필실처럼 chat을 직접 만든 화면은 그 Hook에 넘긴다. */
  getPage?: () => ChatPage | undefined
  /** Content 쓰기 도구 승인 카드가 설정 카드의 수정 전 값을 찾는 함수(세계관 화면)와, 작성 중인 변경이 있어 승인을 막아야 하는지. */
  cardOf?: (id: string) => { title: string; body: string } | undefined
  unsaved?: boolean
  worldDraft?: WorldDraftRevision
  /** 다음 메시지에 함께 보내지는 화면의 선택 글 안내(집필실, #636). */
  sendNote?: string
  /** 시뮬레이션 시작 양식을 연다(집필실). 없으면 양식을 여는 선택지(#794)를 보이지 않는다. */
  onOpenSetup?: () => void
}

export function WritingChat({ chat, basis = null, onApplied, onWorldApplied, getPage, ...rest }: WritingChatProps) {
  return chat ? <WorkChat key={rest.workId} vm={chat} {...rest} /> : <OwnedChat key={rest.workId} basis={basis} onApplied={onApplied} onWorldApplied={onWorldApplied} getPage={getPage} {...rest} />
}

function OwnedChat({ basis, onApplied, onWorldApplied, getPage, ...rest }: Omit<WritingChatProps, 'chat'>) {
  const vm = useWritingChatViewModel(rest.workId, basis ?? null, onApplied, onWorldApplied, getPage)
  return <WorkChat vm={vm} {...rest} />
}

function WorkChat({ vm, workId, emptyTitle, emptyText, suggestions, onOpenStage, onOpenProposal, cardOf, unsaved, worldDraft, sendNote, onOpenSetup }: { vm: ChatViewModel } & Pick<WritingChatProps, 'workId' | 'emptyTitle' | 'emptyText' | 'suggestions' | 'onOpenStage' | 'onOpenProposal' | 'cardOf' | 'unsaved' | 'worldDraft' | 'sendNote' | 'onOpenSetup'>) {
  const id = useId()
  const input = useRef<HTMLTextAreaElement>(null) // 선택지를 누른 뒤 초점을 돌려 줄 메시지 입력창(비활성이 되는 선택지 버튼에 초점이 남지 않게)
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const live = vm.live
  // 고쳐 보낸 전송이 시작되면 폼을 닫는다(#639): 실패 뒤 이력이 바뀌어도 그 번호의 다른 메시지에 옛 글이 뜨지 않는다. 보내기 전에 막히면(inputError) live가 없어 폼이 남는다.
  useEffect(() => { if (live?.editIndex !== undefined) setEditing(null) }, [live?.editIndex])
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
    // 참고안 링크는 종합 답변이 없어도 보인다(#640). 접은 단계별 결과·승인 결과 줄은 종합 답변이 있을 때만이다.
    const index = Number(m.id.slice(1))
    const reply = shown[index]?.reply
    const rating = shown[index]?.feedback ?? null
    // 멈춘 실행이 있으면 서버가 평가를 409로 막는다(대화 기록을 고치면 멈춘 자리가 사라진다).
    // 저장 중에는 누른 버튼을 잠그지 않는다(잠그면 키보드 초점이 body로 떨어진다). 다시 누르는 것만 무시한다.
    const rateLocked = !!live || !!vm.waiting
    const lockedTitle = '진행 중인 작업을 마치면 평가할 수 있어요.'
    const rate = (value: 'up' | 'down') => { if (!vm.pending) void vm.rate(index, rating === value ? null : value) }
    const text = reply && m.format === 'markdown' ? replyText(reply) : ''
    const outcome = text && reply ? replyOutcome(reply) : []
    const activities = vm.activityLog[index]
    // 선택지(#794)는 마지막 턴에서만 누를 수 있고 지난 턴은 비활성으로 남긴다. 누르면 그 문장을 새 메시지로 보낸다(입력창도 그대로 쓸 수 있다).
    const choices = reply ? replyChoices(reply).filter((c) => !c.form || onOpenSetup) : []
    const choosable = index === vm.turns.length - 1 && !live && !vm.pending && !vm.waiting && !vm.lockedReason
    return <>
      {outcome.map((line, i) => <p key={i} className="chat-note">{line}</p>)}
      {!!activities?.length && <details className="chat-step-details chat-activity-log"><summary>작업 {activities.length}개</summary><Activities list={activities} finished /></details>}
      {reply?.steps.map((s, i) => <References key={`${s.feature}-${i}`} step={s} />)}
      {!!choices.length && <div className="chat-choices" role="group" aria-label="고를 수 있는 답">
        {choices.map((c, i) => <button key={i} type="button" className="chat-suggest-btn" disabled={!choosable} title={c.form ? undefined : c.message}
          onClick={() => { if (c.form) onOpenSetup?.(); else { void vm.send(c.message); input.current?.focus() } }}>{c.label}</button>)}
      </div>}
      <div className="chat-reply-foot">
        {text && <details className="chat-step-details"><summary>단계별 결과 보기</summary><p>{text}</p></details>}
        <div className="chat-msg-actions">
          <button type="button" aria-label="이 답변 좋아요" title={rateLocked ? lockedTitle : '이 답변 좋아요'} aria-pressed={rating === 'up'} disabled={rateLocked} onClick={() => rate('up')}><ThumbUpIcon size={16} /></button>
          <button type="button" aria-label="이 답변 싫어요" title={rateLocked ? lockedTitle : '이 답변 싫어요'} aria-pressed={rating === 'down'} disabled={rateLocked} onClick={() => rate('down')}><ThumbDownIcon size={16} /></button>
        </div>
      </div>
    </>
  }
  if (live) messages.push({ id: 'live', role: 'user', text: live.request, attachments: attachmentsOf(live.attachments) })
  const actions = (m: ChatMessage) => {
    if (m.role !== 'user' || m.id === 'live') return null
    const index = Number(m.id.slice(1))
    if (editing?.index === index) {
      return <form className="chat-edit" onSubmit={(e) => { e.preventDefault(); const text = editing.text.trim(); if (text) void vm.edit(index, text) }}>
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
    <div className="chat-sessions" {...keepFiles}>
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
    <ChatPanel messages={messages} onSend={(text, files) => vm.send(text, files.length ? { files } : undefined)} checkFile={checkAttachment} busy={vm.pending} disabledReason={vm.lockedReason} inputError={vm.inputError} sendNote={sendNote}
      emptyTitle={emptyTitle} emptyText={emptyText} suggestions={[...suggestions, ...simulationExamples]} renderCard={stepDetails} renderActions={actions} streaming={live?.answer} inputRef={input}
      after={live || vm.waiting || vm.error ? <>
        {live && <Progress live={live} onOpenStage={onOpenStage} />}
        {vm.waiting && <Waiting key={`${vm.threadId}-${vm.turns.length}`} workId={workId ?? ''} request={vm.turns.at(-1)?.request ?? ''} reply={vm.waiting} pending={vm.pending} onResume={(approved, inputs, pick) => void vm.resume(approved, inputs, pick)} onOpenStage={onOpenStage} onOpenProposal={onOpenProposal} cardOf={cardOf} unsaved={unsaved} worldDraft={worldDraft}
          onRefreshProposal={() => void vm.refreshProposal()} />}
        {vm.error && <div className="chat-error" role="alert"><p>{vm.error}</p><button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button></div>}
      </> : undefined} />
  </>
}

import { sceneSummary, type CharacterSimulation, type SimulationStart } from './characterSimulation'
import type { WritingEpisode } from './content'
import { FINDING_KINDS, type ReviewFinding as WorldFinding } from './worldReview'

/** 집필 AI 채팅(#331). 대화 원본은 AI 서비스의 LangGraph 체크포인터이며 화면은 Content API로만 읽고 쓴다. */
export type ChatFeature = 'story_context' | 'writing_editing' | 'web_research' | 'character_simulation' | 'review' | (string & {})
// both는 Router가 두 검수를 함께 고른 결과(#369)다. 작가에게 묻는 화면은 두 가지 중 하나만 고른다.
export type ReviewCheck = 'mechanical' | 'semantic' | 'both'
/** 원고 검수 지적 하나. 위치는 초안 본문의 UTF-16 [start,end)이고 같은 구절이 여러 곳이면 null이다(AI가 추측하지 않는다). */
export type ReviewFinding = {
  category: string; quote: string; reason: string; status: 'confirmed' | 'suspected' | 'undeterminable'
  evidenceRefs: string[]; suggestion: string; start: number | null; end: number | null
}
/** 원고 검수(#59) 단계의 검증된 결과. 검수한 초안의 회차·판본과 확인하지 못한 부분(gaps)을 함께 둔다. */
export type ChatReview = { check: ReviewCheck; episode: number; revision: number; findings: ReviewFinding[]; gaps: string[] }
export type RatingVerdict = 'adult' | 'general' | 'needsReview'
/** 심의 등급 판별 단계의 검증된 결과. 판정은 제안이며 작품 등급을 바꾸지 않는다. 회차 verdict가 null이면 그 회차는 판별 실패(error)다. */
export type ChatRating = {
  verdict: RatingVerdict; prohibited: boolean
  episodes: { episode: number; verdict: RatingVerdict | null; prohibited: boolean; error: string | null
    assessments: { criterion: string; level: number; quotes: string[]; rationale: string }[] }[]
}
/** 설정집 검토 단계 결과. 웹 조사와 같은 키(findings)를 쓰지만 모양이 달라 따로 둔다. */
export type ChatWorldReview = { findings: Pick<WorldFinding, 'kind' | 'message'>[] }
export type ChatStepResult = {
  claims?: { text: string }[]
  gaps?: string[]
  text?: string
  before?: string
  after?: string
  findings?: { text: string; verdict: string; sourceUrls: string[] }[]
  /** 전개 기획(#387)의 계획 대안과 참고. 원고가 아니라 반영하지 않는다. */
  plans?: BeatPlan[]
  notes?: string[]
  /** 계획 없이 바로 쓴 원고(text)가 스스로 정해 쓴 계획 */
  plan?: BeatPlan | null
}
export type BeatPlan = { title: string; beats: string[] }
export type ChatStep = {
  feature: ChatFeature
  /** if_issues_found는 직전 검수에서 확정 지적이 있을 때만 고치는 조건부 수정이다(#370). skipped는 고칠 것이 없어 건너뛴 단계(error가 이유)다. */
  when?: 'always' | 'if_issues_found'
  /** writing_editing 단계에 Router가 정한 작업 종류(#387). patch(선택 구간 수정)는 채팅에서 입력을 채울 수 없다. */
  task?: 'plan' | 'draft' | 'patch' | null
  status: 'completed' | 'failed' | 'not_started' | 'skipped'
  result?: ChatStepResult | null
  /** character_simulation 단계의 검증된 결과(#58). 형식이 어긋난 결과는 이 값 없이 실패한 단계로 들어온다. */
  simulation?: CharacterSimulation | null
  /** review 단계의 검증된 결과. 형식이 어긋난 결과는 이 값 없이 실패한 단계로 들어온다. */
  review?: ChatReview | null
  /** rating 단계의 검증된 결과. 형식이 어긋난 결과는 이 값 없이 실패한 단계로 들어온다. */
  rating?: ChatRating | null
  /** world_review 단계의 검증된 결과(#479). 채팅은 지적의 종류·메시지만 보인다. */
  worldReview?: ChatWorldReview | null
  error?: string | null
  approval?: 'approved' | 'declined' | null
  applied?: { episode: number; revision: number } | null
}
export type ChatStatus = 'completed' | 'failed' | 'clarify' | 'rejected' | 'unsupported' | 'needs_input' | 'waiting' | 'cancelled'
export type ChatReply = {
  status: ChatStatus
  message?: string | null
  steps: ChatStep[]
  missingInputs: ChatFeature[]
  awaitingApproval?: ChatFeature | null
  /** 턴마다 멈추는 시뮬레이션 장면이 작가의 조작(다음 턴·수정·다시 말하기·끝내기)을 기다린다(#58 무대). */
  awaitingScene?: ChatFeature | null
  approvalEpisode?: number | null
}
export type ChatTurn = { request: string; reply: ChatReply | null }
export type ChatSession = { threadId: string; title: string; updatedAt: string }
export type ChatHistory = { threadId: string; title: string; turns: ChatTurn[] }
/** 오케스트레이션 SSE 이벤트. plan → (started → step)* → waiting? → done, 실패는 error 하나. */
export type ChatEvent =
  | { type: 'plan'; steps: ChatStep[] }
  | { type: 'started'; feature: ChatFeature }
  | { type: 'step'; step: ChatStep }
  | { type: 'waiting'; steps: ChatStep[]; missingInputs: ChatFeature[]; awaitingApproval?: ChatFeature | null; awaitingScene?: ChatFeature | null }
  | { type: 'done'; reply: ChatReply }
  | { type: 'error'; message: string }
/**
 * Q&A 근거 기준(지식 상한). Content가 발행 회차만 기준으로 받는다.
 * targetEpisode는 결과를 반영할 회차(작가가 연 회차, 발행 전 초안이어도 된다)이고 없으면 서버가 근거 회차와 같게 본다.
 */
export type ChatBasis = { episode: number; episodeVersionId: string; targetEpisode?: number }
/** 입력 대기에서 작가가 채우는 단계 입력. 이름은 AI StepInputs 계약과 같다. */
export type ChatStepInputs = {
  web_research?: { question: string }
  review?: { check: ReviewCheck }
  /** fix는 조건부 수정에서 고른 검수 지적의 번호(검수 결과 findings 순서)다. */
  writing_editing?: { draft: { episodeNumber: number; plan: string } } | { patch: { selection: string; instruction: string } } | { fix: number }
}
/** 시뮬레이션 무대에서 작가가 장면에 거는 조작(AI `Resume.scene`, Content `WritingAiResume.scene`을 그대로 통과한다). */
export type SceneAction =
  | { action: 'next'; note?: string }
  | { action: 'edit'; turn: number; text: string }
  | { action: 'redo'; turn: number; note?: string }
  | { action: 'stop' }
/** 멈춘 실행을 이어 가는 답. 장면 조작이면 scene을 싣고, approved는 서버 검증을 위해 함께 보낸다(장면 조작 뒤에는 다시 멈춘다). */
export type ChatResume = { approved: boolean; inputs?: ChatStepInputs; scene?: SceneAction }
/** 새 요청(operation이 있으면 의도 분류를 건너뛰고 그 기능을 실행, 시뮬레이션은 시작 양식 값을 싣는다)이거나 멈춘 실행을 잇는 답이다. */
export type ChatSendBody = { request: string; operation?: ChatFeature; simulation?: SimulationStart } | { resume: ChatResume }
export type ChatMessageInput = ChatBasis & { consent: true } & ChatSendBody

export const SCENE_NOTE_MAX = 300
export const SCENE_TEXT_MAX = 2000
const turnNumber = (turn: number) => {
  if (!Number.isInteger(turn) || turn < 0) throw new Error('고칠 줄을 찾을 수 없어요.')
  return turn
}
const noteText = (note?: string) => {
  const text = note?.trim()
  if (text && text.length > SCENE_NOTE_MAX) throw new Error(`끼어들기는 ${SCENE_NOTE_MAX}자까지 적을 수 있어요.`)
  return text ? { note: text } : {}
}
/** 장면 조작을 보낼 모양으로 다듬는다(서버 검증과 같은 한도). 보낼 수 없으면 이유를 던진다. */
export function cleanScene(scene: SceneAction): SceneAction {
  switch (scene.action) {
    case 'stop': return { action: 'stop' }
    case 'next': return { action: 'next', ...noteText(scene.note) }
    case 'redo': return { action: 'redo', turn: turnNumber(scene.turn), ...noteText(scene.note) }
    case 'edit': {
      const text = scene.text.trim()
      if (!text) throw new Error('고친 글이 비어 있어요. 줄을 지우려면 다시 말하기를 써 주세요.')
      if (text.length > SCENE_TEXT_MAX) throw new Error(`고친 글은 ${SCENE_TEXT_MAX.toLocaleString('ko-KR')}자까지 적을 수 있어요.`)
      return { action: 'edit', turn: turnNumber(scene.turn), text }
    }
  }
}

export const featureLabel: Record<string, string> = { story_context: '작품 질문', writing_editing: '기획·집필·수정', web_research: '고증 조사', character_simulation: '인물 시뮬레이션', review: '원고 검수', rating: '심의 등급', world_review: '설정집 검토' }
export const reviewCheckLabel: Record<ReviewCheck, string> = { mechanical: '맞춤법·표기', semantic: '설정·개연성', both: '설정·개연성 + 맞춤법·표기' }
const reviewStatus: Record<ReviewFinding['status'], string> = { confirmed: '확정', suspected: '의심', undeterminable: '판단 불가' }
const reviewCategory: Record<string, string> = {
  number: '수치', name: '이름', date: '날짜', repetition: '중복 표현', spelling: '맞춤법',
  setting: '설정 충돌', knowledge: '인물 지식', emotion: '감정 변화', causality: '인과관계', foreshadowing: '복선',
}

function reviewText({ check, episode, findings, gaps }: ChatReview): string {
  const title = `${episode}화 초안 ${reviewCheckLabel[check]} 검수`
  if (!findings.length && !gaps.length) return `${title}: 찾은 문제가 없어요.`
  return [title, ...findings.map((f) => [
    `${reviewStatus[f.status]} · ${reviewCategory[f.category] ?? f.category} · "${f.quote}"${f.start === null ? ' (여러 곳)' : ''}`,
    `이유: ${f.reason}`, ...(f.suggestion ? [`제안: ${f.suggestion}`] : []),
  ].join('\n')), ...gaps.map((g) => `확인 못 함: ${g}`)].join('\n\n')
}

const ratingVerdict: Record<RatingVerdict, string> = { adult: '19세 이용가', general: '전체 이용가', needsReview: '작가 검토 필요' }
// needsReview는 AI가 다시 판정하지 않고 작가가 근거를 보고 정한다(#439).
const AUTHOR_REVIEW = 'AI가 등급을 정하지 않았어요. 아래 근거를 보고 작가님이 직접 판단해 주세요.'
const ratingCriterion: Record<string, string> = {
  sexual: '선정성', violence: '폭력성', crime: '범죄', drug: '약물', gambling: '사행성', language: '언어', other: '기타 유해',
}

// 판정을 좌우한 수준 2 이상 항목만 근거와 함께 보인다.
function ratingText({ verdict, prohibited, episodes }: ChatRating): string {
  return [`판정 제안: ${ratingVerdict[verdict]}${prohibited ? ' · 금지 표현 의심(운영 검토 대상)' : ''}${verdict === 'needsReview' ? `\n${AUTHOR_REVIEW}` : ''}`,
    ...episodes.map((e) => (e.verdict === null ? `${e.episode}화: 판별 실패 · ${e.error ?? ''}` : [`${e.episode}화: ${ratingVerdict[e.verdict]}`,
      ...e.assessments.filter((a) => a.level >= 2).map((a) =>
        `${ratingCriterion[a.criterion] ?? a.criterion} 수준 ${a.level} · ${a.rationale}${a.quotes.length ? ` · "${a.quotes[0]}"` : ''}`),
    ].join('\n')))].join('\n\n')
}

/**
 * 근거 회차(지식 상한, 발행된 판본 필요)와 반영 회차(targetEpisode, 작가가 연 회차)를 나눠 고른다.
 * 열린 회차가 발행돼 있으면 그 회차가 둘 다이고, 발행 전 초안이면 그 앞의 가장 뒤 발행 회차를 근거로 열린 회차에 반영한다
 * (서버는 targetEpisode ≥ episode만 받으므로 근거는 열린 회차보다 뒤가 되지 않게 고른다).
 * 열린 회차를 모르거나 목록에 없으면 가장 뒤의 발행 회차만 근거로 쓰고 반영 회차는 보내지 않는다. 근거가 없으면 null(채팅을 잠근다).
 */
export function chatBasis(episodes: WritingEpisode[], open?: number): ChatBasis | null {
  const known = open !== undefined && episodes.some((e) => e.number === open)
  const pick = episodes
    .filter((e) => e.publishedVersionId && (!known || e.number <= open))
    .reduce<WritingEpisode | undefined>((last, e) => (!last || e.number > last.number ? e : last), undefined)
  return pick?.publishedVersionId ? { episode: pick.number, episodeVersionId: pick.publishedVersionId, ...(known ? { targetEpisode: open } : {}) } : null
}

const researchVerdict: Record<string, string> = { confirmed: '확인됨', conflicting: '근거 상충', unverified: '미확인' }

/** 단계 결과를 채팅 말풍선 글로. 결과가 없거나 실패면 그 사유를 그대로 보인다(성공처럼 꾸미지 않는다). */
export function stepText(step: ChatStep): string {
  if (step.status === 'failed') return `실패: ${step.error ?? '작업을 완료하지 못했어요.'}`
  if (step.status === 'skipped') return `건너뜀: ${step.error ?? '할 일이 없어 건너뛰었어요.'}`
  if (step.simulation) return sceneSummary(step.simulation)
  if (step.review) return reviewText(step.review)
  if (step.rating) return ratingText(step.rating)
  if (step.worldReview) return step.worldReview.findings.map((f) => `${FINDING_KINDS[f.kind]} · ${f.message}`).join('\n') || '검토에서 찾은 문제가 없어요.'
  const r = step.result
  if (step.status !== 'completed' || !r) return ''
  if (r.claims) return [...r.claims.map((c) => c.text), ...(r.gaps ?? []).map((g) => `확인 못 함: ${g}`)].join('\n') || '근거를 찾지 못했어요.'
  if (r.findings) return [...r.findings.map((f) => `${researchVerdict[f.verdict] ?? researchVerdict.unverified} · ${f.text}${f.sourceUrls.length ? ` (${f.sourceUrls.join(', ')})` : ''}`), ...(r.gaps ?? []).map((g) => `확인 못 함: ${g}`)].join('\n') || '조사 결과가 없어요.'
  if (r.after !== undefined) return `수정 전: ${r.before ?? ''}\n수정 후: ${r.after}`
  if (r.plans) return [...r.plans.map((p, i) => [`계획 ${i + 1}. ${p.title}`, ...p.beats.map((b, j) => `  ${j + 1}) ${b}`)].join('\n')),
    ...(r.notes ?? []).map((n) => `참고: ${n}`), PLAN_PICK_HINT].join('\n')
  return r.text ?? ''
}

/** 기획 결과에서 한 안을 골라 이어 쓰는 방법. 서버 previousPlans는 최근 5턴 중 가장 최근 기획 결과만 받는다(#441). */
export const PLAN_PICK_HINT = "가장 최근 기획한 안 중 하나를 '계획 1로 써줘'처럼 말하면 그 계획으로 써요."

/** 바로 쓴 원고가 정해 쓴 계획 한 줄. 반영 본문(stepText)과 섞지 않도록 따로 보인다. */
export const usedPlan = (step: ChatStep) => (step.result?.plan ? `사용한 계획: ${step.result.plan.title} — ${step.result.plan.beats.join(' / ')}` : '')

/** 턴 응답 전체를 말풍선 하나의 글로. 실행하지 않은 턴은 안내 문구만, 실행한 턴은 단계별 결과를 계획 순서로 잇는다. */
export function replyText(reply: ChatReply): string {
  const steps = reply.steps.filter((s) => s.status !== 'not_started')
    .map((s) => `[${featureLabel[s.feature] ?? s.feature}] ${stepText(s)}${s.status === 'completed' && usedPlan(s) ? `\n${usedPlan(s)}` : ''}${s.applied ? `\n→ ${s.applied.episode}화 초안에 반영했어요.` : s.approval === 'declined' ? '\n→ 반영하지 않았어요.' : ''}`)
  return [reply.message, ...steps].filter(Boolean).join('\n\n') || '응답 내용이 없어요.'
}

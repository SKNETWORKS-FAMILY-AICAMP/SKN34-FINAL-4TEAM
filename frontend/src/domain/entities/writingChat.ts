import { sceneSummary, type CharacterSimulation, type SimulationStart } from './characterSimulation'
import type { ChatAttachmentPayload, ChatTurnAttachment } from './chatAttachment'
import type { WritingEpisode } from './content'
import { FINDING_KINDS, type ReviewFinding as WorldFinding } from './worldReview'

/** 집필 AI 채팅(#331). 대화 원본은 AI 서비스의 LangGraph 체크포인터이며 화면은 Content API로만 읽고 쓴다. */
export type ChatFeature = 'story_context' | 'writing_editing' | 'research' | 'character_simulation' | 'manuscript_review' | (string & {})
// both는 Router가 두 검수를 함께 고른 결과(#369)다. 작가에게 묻는 화면은 두 가지 중 하나만 고른다.
export type ReviewCheck = 'mechanical' | 'semantic' | 'both'
/** 원고 검수 지적 하나. 위치는 초안 본문의 UTF-16 [start,end)이고 같은 구절이 여러 곳이면 null이다(AI가 추측하지 않는다). */
export type ReviewFinding = {
  category: string; quote: string; reason: string; status: 'confirmed' | 'suspected' | 'undeterminable'
  evidenceRefs: string[]; suggestion: string; start: number | null; end: number | null
}
/** 원고 검수(#59) 단계의 검증된 결과. 검수한 초안의 회차·판본과 확인하지 못한 부분(gaps)을 함께 둔다. */
export type ChatReview = {
  check: ReviewCheck; episode: number; revision: number; findings: ReviewFinding[]; gaps: string[]
  candidate?: { selection: { start: number; end: number } | null }
}
export type RatingVerdict = 'adult' | 'general' | 'needsReview'
/** 심의 등급 판별 단계의 검증된 결과. 판정은 제안이며 작품 등급을 바꾸지 않는다. 회차 verdict가 null이면 그 회차는 판별 실패(error)다. */
export type ChatRating = {
  verdict: RatingVerdict; prohibited: boolean
  episodes: { episode: number; verdict: RatingVerdict | null; prohibited: boolean; error: string | null
    assessments: { criterion: string; level: number; quotes: string[]; rationale: string }[] }[]
}
/** 설정집 검토 단계 결과. 웹 조사와 같은 키(findings)를 쓰지만 모양이 달라 따로 둔다. */
export type ChatWorldReview = { reviewedCards: number; findings: Pick<WorldFinding, 'kind' | 'message'>[] }
/** World 단계(#546) enrich 수정안 하나: 카드 하나의 한 칸을 바꿀 새 글 전체. episode는 target이 episode일 때만 있다. */
export type WorldFix = { cardId: string; cardTitle: string; target: 'body' | 'soul' | 'goal' | 'episode'; episode: number | null; text: string }
/** World 단계 impact가 알려 주는 영향 하나. 화면이 쓰는 값만 받는다(영향 종류·참조 id는 글에 쓰지 않는다). */
export type WorldImpact = { title: string; reason: string; certainty: 'confirmed' | 'inferred' }
/** World 단계 결과. task마다 모양이 다르고 check는 설정집 검토와 같다. enrich는 작가가 승인해야 설정집 초안에 반영된다. */
export type ChatWorld =
  | ({ task: 'check' } & ChatWorldReview)
  | { task: 'enrich'; fixes: WorldFix[]; note: string }
  | { task: 'impact'; affected: WorldImpact[]; conflicts: string[]; gaps: string[] }
/** 계획 수정안(#578)의 제목·내용. 수정 범위는 이 둘뿐이다. */
export type PlanText = { title: string; content: string }
/** writing_editing 단계(task=revise_plan)의 수정안: 저장된 플롯·장면 계획 하나의 변경 전·후. 작가가 승인해야 그 계획에 저장된다. */
export type ChatPlanRevision = { kind: 'plot' | 'scene'; before: PlanText; after: PlanText }
/** 참고 카드 하나의 출처. worldId·cardId는 카드 화면 링크(`/worlds/:id/cards/:cardId`)용이다. */
export type ChatReference = { worldId: string; worldName: string; cardId: string; cardTitle: string; authorNickname: string; note: string }
export const referenceHref = (r: ChatReference) => `/worlds/${encodeURIComponent(r.worldId)}/cards/${encodeURIComponent(r.cardId)}`
export type ChatStepResult = {
  /** content_action 단계(#554): 승인 뒤 메인 에이전트가 직접 실행한 Content 도구 이름과 고정 문구 */
  tool?: string
  label?: string
  claims?: { text: string }[]
  gaps?: string[]
  text?: string
  before?: string
  after?: string
  findings?: { text: string; verdict: string; sourceUrls: string[] }[]
  /** Research platform(#547)의 참고안. 다른 작가가 공개한 세계관의 카드이며 내 설정집에 복사하지 않는다. 웹 조사 결과(findings)와 키로 구분한다. */
  references?: ChatReference[]
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
  /** writing_editing 단계에 Router가 정한 작업 종류(#387). patch(선택 구간 수정)는 채팅에서 입력을 채울 수 없고 revise_plan(#578)은 저장된 계획의 수정안이다. world 단계는 check·enrich·impact(#546)다. */
  task?: 'plan' | 'draft' | 'patch' | 'revise_plan' | 'check' | 'enrich' | 'impact' | null
  status: 'completed' | 'failed' | 'not_started' | 'skipped'
  result?: ChatStepResult | null
  /** character_simulation 단계의 검증된 결과(#58). 형식이 어긋난 결과는 이 값 없이 실패한 단계로 들어온다. */
  simulation?: CharacterSimulation | null
  /** manuscript_review 단계의 검증된 결과. 형식이 어긋난 결과는 이 값 없이 실패한 단계로 들어온다. */
  manuscriptReview?: ChatReview | null
  /** rating 단계의 검증된 결과. 형식이 어긋난 결과는 이 값 없이 실패한 단계로 들어온다. */
  rating?: ChatRating | null
  /** world_review 단계의 검증된 결과(#479). 채팅은 지적의 종류·메시지만 보인다. */
  worldReview?: ChatWorldReview | null
  /** world 단계의 검증된 결과(#546). 옛 world_review 단계는 worldReview에 남는다. 형식이 어긋난 결과는 이 값 없이 실패한 단계로 들어온다. */
  world?: ChatWorld | null
  /** writing_editing 단계(task=revise_plan)의 검증된 결과(#578). 형식이 어긋난 결과는 이 값 없이 실패한 단계로 들어온다. */
  planRevision?: ChatPlanRevision | null
  error?: string | null
  approval?: 'approved' | 'declined' | null
  applied?: { episode: number; revision: number } | null
}
/** 작가의 승인을 기다리는 Content 쓰기 도구(#554). 모델의 요약이 아니라 실제로 실행할 도구와 인자다. label은 서버의 도구별 고정 문구다. */
export type PendingAction = { tool: string; label: string; args: Record<string, unknown> }
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
  /** awaitingApproval이 content_action일 때 실행을 기다리는 도구와 인자 */
  pendingAction?: PendingAction | null
}
/** attachments는 그 턴에 보낸 첨부의 이름·종류다(원본은 남지 않는다). 첨부 기능 전의 턴과 첨부 없는 턴은 비었거나 없다. */
export type ChatTurn = { request: string; reply: ChatReply | null; attachments?: ChatTurnAttachment[] }
export type ChatSession = { threadId: string; title: string; updatedAt: string }
export type ChatHistory = { threadId: string; title: string; turns: ChatTurn[] }
/** 오케스트레이션 SSE 이벤트. plan → (started → step)* → waiting? → done, 실패는 error 하나. 답변을 쓰는 동안 사이사이 answer가 온다(#618). */
export type ChatEvent =
  | { type: 'plan'; steps: ChatStep[] }
  | { type: 'started'; feature: ChatFeature }
  | { type: 'step'; step: ChatStep }
  | { type: 'waiting'; steps: ChatStep[]; missingInputs: ChatFeature[]; awaitingApproval?: ChatFeature | null; awaitingScene?: ChatFeature | null; pendingAction?: PendingAction | null }
  | { type: 'done'; reply: ChatReply }
  | { type: 'answer'; delta: string | null }
  | { type: 'error'; message: string }
/** 쓰는 중인 답변 본문(#618). delta가 null이면 비우고, 실패하면 쓰다 만 글을 버린다. 정상 종료에는 저장된 답으로 바뀔 때까지 남긴다. */
export function streamedAnswer(text: string, event: ChatEvent): string {
  if (event.type === 'answer') return event.delta === null ? '' : text + event.delta
  return event.type === 'error' || (event.type === 'done' && event.reply.status === 'failed') ? '' : text
}
/**
 * Q&A 근거 기준(지식 상한). Content가 발행 회차만 기준으로 받는다.
 * targetEpisode는 결과를 반영할 회차(작가가 연 회차, 발행 전 초안이어도 된다)이고 없으면 서버가 근거 회차와 같게 본다.
 */
export type ChatBasis = { episode: number; episodeVersionId: string; targetEpisode?: number }
/**
 * 작가가 지금 보고 있는 화면(#554). 메시지마다 싣는다(이어가기에는 싣지 않는다). Content가 권한을 다시 확인하고 AI가 그 턴에만 본다.
 * path는 표시용이고 인가에 쓰이지 않는다. content는 저장하지 않은 편집이 있을 때만 싣는다.
 */
export type ChatPage = {
  path: string; kind: 'studio' | 'world'
  episode?: number; worldId?: string; cardId?: string; view?: string; selection?: string
  content?: { title?: string; body: string; unsaved: true; truncated?: boolean }
}
// 서버(Content `WritingAiPage`·AI `PageContext`)와 같은 상한이다.
export const PAGE_PATH_MAX = 300
export const PAGE_SELECTION_MAX = 5000
export const PAGE_TITLE_MAX = 300
export const PAGE_BODY_MAX = 10000
export type ChatPageInput = Omit<ChatPage, 'content'> & { unsaved?: { title?: string; body: string } }

// UTF-16 길이로 자르되 서로게이트 쌍의 가운데는 피한다(서버 검증이 UTF-16 길이로 센다).
const clip = (text: string, max: number) => {
  if (text.length <= max) return text
  const high = text.charCodeAt(max - 1)
  return text.slice(0, high >= 0xd800 && high <= 0xdbff ? max - 1 : max)
}
/**
 * 화면 정보를 보낼 모양으로 조립한다. 선택한 글이 5,000자를 넘으면 전송 전에 구간을 줄이도록 알린다.
 * 저장하지 않은 편집 내용(unsaved)이 있으면 본문을 10,000자까지 싣고 넘으면 잘라 truncated를 붙인다. 호출한 화면이 dirty일 때만 unsaved를 준다.
 */
export function chatPage({ path, selection, unsaved, ...rest }: ChatPageInput): ChatPage {
  const page: ChatPage = { ...rest, path: clip(path, PAGE_PATH_MAX) }
  if (selection && selection.length > PAGE_SELECTION_MAX) {
    throw new Error(`선택한 글은 ${PAGE_SELECTION_MAX.toLocaleString('ko-KR')}자까지 보낼 수 있어요. 선택 범위를 줄이거나 선택을 해제한 뒤 다시 보내 주세요.`)
  }
  if (selection?.trim()) page.selection = selection
  if (unsaved) {
    const body = clip(unsaved.body, PAGE_BODY_MAX)
    page.content = { ...(unsaved.title ? { title: clip(unsaved.title, PAGE_TITLE_MAX) } : {}), body, unsaved: true, ...(body.length < unsaved.body.length ? { truncated: true } : {}) }
  }
  return page
}

export type WorldDraftRevision = { id: string; revision: number }

export function worldProposalIsStale(action: PendingAction, draft?: WorldDraftRevision): boolean {
  if (!draft || action.tool !== 'world_studio_edit_draft' || action.args.id !== draft.id) return false
  const request = action.args.request ?? action.args
  const expected = request && typeof request === 'object' && 'expectedDraftRevision' in request ? request.expectedDraftRevision : undefined
  return typeof expected === 'number' && expected !== draft.revision
}

/** 승인 카드가 보이는 바꿈 한 칸: 수정 전(없으면 새로 만드는 값)과 후. */
export type PendingChange = { name: string; before: string | null; after: string }
/**
 * 세계관 설정 카드 수정(world_studio_edit_draft)이 바꿀 이름·설명의 수정 전과 후. 저장된 카드는 cardOf로 찾고 없으면 새 설정이다.
 * 다른 도구나 모양이 어긋난 인자는 칸을 만들지 않는다(화면이 도구 인자를 그대로 보인다).
 */
export function pendingChanges(action: PendingAction, cardOf?: (id: string) => { title: string; body: string } | undefined): PendingChange[] {
  if (action.tool !== 'world_studio_edit_draft') return []
  const request = action.args.request ?? action.args // 모델이 request로 감싸지 않고 평평하게 보낸 호출도 읽는다
  const cards = request && typeof request === 'object' ? (request as { cards?: unknown }).cards : undefined
  if (!Array.isArray(cards)) return []
  return cards.flatMap((card): PendingChange[] => {
    if (!card || typeof card !== 'object') return []
    const { id, title, body } = card as { id?: unknown; title?: unknown; body?: unknown }
    const old = typeof id === 'string' ? cardOf?.(id) : undefined
    const name = old?.title ?? (typeof title === 'string' && title ? title : '새 설정')
    return [
      ...(typeof title === 'string' && title !== old?.title ? [{ name: `${name} · 이름`, before: old?.title ?? null, after: title }] : []),
      ...(typeof body === 'string' && body !== old?.body ? [{ name: `${name} · 설명`, before: old?.body ?? null, after: body }] : []),
    ]
  })
}
/** 입력 대기에서 작가가 채우는 단계 입력. 이름은 AI StepInputs 계약과 같다. */
export type ChatStepInputs = {
  research?: { question: string }
  manuscript_review?: { check: ReviewCheck }
  /** fix는 조건부 수정에서 고른 검수 지적의 번호(검수 결과 findings 순서)다. */
  /** span은 채팅 입력 대기에서 고른 초안 구간이다(#497). Content가 검증해 patch로 바꿔 AI에 넘긴다. start·end는 초안 본문의 UTF-16 위치 [start, end)다. */
  writing_editing?: { draft: { episodeNumber: number; plan: string } } | { patch: { selection: string; instruction: string } } | { fix: number }
    | { span: { episode: number; revision: number; start: number; end: number; instruction: string } }
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
/** attachments는 새 요청에서만 보내는 이번 턴의 참고 자료(최대 3개, #617)다. 이어가기·메시지 수정에는 싣지 않는다. */
export type ChatSendBody = { request: string; operation?: ChatFeature; simulation?: SimulationStart; page?: ChatPage; attachments?: ChatAttachmentPayload[] } | { resume: ChatResume }
export type ChatMessageInput = ChatBasis & ChatSendBody

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

export const featureLabel: Record<string, string> = { content_action: 'Content 작업', story_context: '작품 질문', writing_editing: '기획·집필·수정', research: '고증 조사', web_research: '고증 조사', character_simulation: '인물 시뮬레이션', manuscript_review: '원고 검수', rating: '심의 등급', world: '세계관', world_review: '설정집 검토' }
export const reviewCheckLabel: Record<ReviewCheck, string> = { mechanical: '맞춤법·표기', semantic: '설정·개연성', both: '설정·개연성 + 맞춤법·표기' }
const reviewStatus: Record<ReviewFinding['status'], string> = { confirmed: '확정', suspected: '의심', undeterminable: '판단 불가' }
const reviewCategory: Record<string, string> = {
  number: '수치', name: '이름', date: '날짜', repetition: '중복 표현', spelling: '맞춤법',
  setting: '설정 충돌', knowledge: '인물 지식', emotion: '감정 변화', causality: '인과관계', foreshadowing: '복선',
}

function reviewText({ check, episode, revision, findings, gaps, candidate }: ChatReview): string {
  const basis = candidate ? `승인 전 집필 후보 (기준 초안 판본 ${revision})` : '초안'
  const selection = candidate?.selection
  const title = `${episode}화 ${basis} ${reviewCheckLabel[check]} 검수${selection ? ' · 선택 구간 수정' : ''}`
  if (!findings.length && !gaps.length) return `${title}: 찾은 문제가 없어요.`
  return [title, ...findings.map((f) => [
    `${reviewStatus[f.status]} · ${reviewCategory[f.category] ?? f.category} · "${f.quote}"${f.start === null ? ' (여러 곳)' : ''}`,
    `이유: ${f.reason}`, ...(f.suggestion ? [`제안: ${f.suggestion}`] : []),
  ].join('\n')), ...gaps.map((g) => `확인 못 함: ${g}`)].join('\n\n')
}

const worldReviewText = ({ reviewedCards, findings }: ChatWorldReview) =>
  findings.map((f) => `${FINDING_KINDS[f.kind]} · ${f.message}`).join('\n') || (reviewedCards ? '검토에서 찾은 문제가 없어요.' : '검토할 설정 카드가 없어요.')

/**
 * 수정안이 바꿀 칸 이름. 인물의 본문은 IDENTITY 문서인데 단계에 카드 종류가 없으므로, 같은 카드에 인물 문서(SOUL·GOAL·회차) 수정안이 함께 있을 때만 IDENTITY라 부른다.
 * 인물 카드의 본문만 고치는 제안은 본문으로 보인다.
 */
const fixField = (f: WorldFix, all: WorldFix[]) =>
  f.target === 'episode' ? `${f.episode}회차 문서` : f.target === 'body' ? (all.some((o) => o.cardId === f.cardId && o.target !== 'body') ? 'IDENTITY' : '본문') : f.target.toUpperCase()
const impactCertainty: Record<WorldImpact['certainty'], string> = { confirmed: '확정', inferred: '추정' }

// enrich는 승인 전에 읽는 제안이라 바꿀 새 글을 그대로 보인다(반영하지 않아도 제안은 대화에 남는다).
function worldText(world: ChatWorld): string {
  switch (world.task) {
    case 'check': return worldReviewText(world)
    case 'enrich': return [...world.fixes.map((f) => `${f.cardTitle} · ${fixField(f, world.fixes)}\n${f.text}`), ...(world.note ? [`참고: ${world.note}`] : [])].join('\n\n')
    case 'impact': return [
      ...world.affected.map((a) => `[${impactCertainty[a.certainty]}] ${a.title} · ${a.reason}`),
      ...world.conflicts.map((c) => `충돌: ${c}`), ...world.gaps.map((g) => `확인 못 함: ${g}`),
    ].join('\n') || '영향을 받는 곳을 찾지 못했어요.'
  }
}

const planKind: Record<ChatPlanRevision['kind'], string> = { plot: '플롯', scene: '장면 계획' }
// 계획 수정안은 승인 전에 읽는 제안이라 변경 전·후 내용을 그대로 보인다(저장하지 않아도 제안은 대화에 남는다).
const planRevisionText = ({ kind, before, after }: ChatPlanRevision) => [
  `${planKind[kind]} '${before.title}' 수정안`, ...(before.title === after.title ? [] : [`제목: ${before.title} → ${after.title}`]),
  `수정 전: ${before.content}`, `수정 후: ${after.content}`].join('\n')

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

/** 대화에 남은 가장 최근 인물 시뮬레이션 장면 단계(끝난 장면 다시 보기, #420). 장면을 읽지 못한(simulation 없는) 단계는 기록이 아니라 건너뛴다. */
export const lastScene = (turns: ChatTurn[]): ChatStep | null =>
  turns.map((turn) => turn.reply?.steps.find((step) => step.feature === 'character_simulation' && step.simulation)).findLast(Boolean) ?? null

const researchVerdict: Record<string, string> = { confirmed: '확인됨', conflicting: '근거 상충', unverified: '미확인' }

/** 단계 결과를 채팅 말풍선 글로. 결과가 없거나 실패면 그 사유를 그대로 보인다(성공처럼 꾸미지 않는다). */
export function stepText(step: ChatStep): string {
  if (step.status === 'failed') return `실패: ${step.error ?? '작업을 완료하지 못했어요.'}`
  if (step.status === 'skipped') return `건너뜀: ${step.error ?? '할 일이 없어 건너뛰었어요.'}`
  if (step.simulation) return sceneSummary(step.simulation)
  if (step.manuscriptReview) return reviewText(step.manuscriptReview)
  if (step.rating) return ratingText(step.rating)
  if (step.worldReview) return worldReviewText(step.worldReview)
  if (step.world) return worldText(step.world)
  if (step.planRevision) return planRevisionText(step.planRevision)
  const r = step.result
  if (step.status !== 'completed' || !r) return ''
  if (r.claims) return [...r.claims.map((c) => c.text), ...(r.gaps ?? []).map((g) => `확인 못 함: ${g}`)].join('\n') || '근거를 찾지 못했어요.'
  if (r.references) return [...r.references.map((x) => `${x.worldName} · ${x.cardTitle} · ${x.authorNickname} — ${x.note}`), ...(r.gaps ?? []).map((g) => `확인 못 함: ${g}`)].join('\n') || '참고할 설정을 찾지 못했어요.'
  if (r.findings) return [...r.findings.map((f) => `${researchVerdict[f.verdict] ?? researchVerdict.unverified} · ${f.text}${f.sourceUrls.length ? ` (${f.sourceUrls.join(', ')})` : ''}`), ...(r.gaps ?? []).map((g) => `확인 못 함: ${g}`)].join('\n') || '조사 결과가 없어요.'
  if (r.after !== undefined) return `수정 전: ${r.before ?? ''}\n수정 후: ${r.after}`
  if (r.plans) return [...r.plans.map((p, i) => [`계획 ${i + 1}. ${p.title}`, ...p.beats.map((b, j) => `  ${j + 1}) ${b}`)].join('\n')),
    ...(r.notes ?? []).map((n) => `참고: ${n}`), ...(r.gaps ?? []).map((g) => `확인 못 함: ${g}`), PLAN_PICK_HINT].join('\n')
  if (r.label) return `${r.label} 완료`
  return r.text ?? ''
}

/** 기획 결과에서 한 안을 골라 이어 쓰는 방법. 서버 previousPlans는 최근 5턴 중 가장 최근 기획 결과만 받는다(#441). */
export const PLAN_PICK_HINT = "가장 최근 기획한 안 중 하나를 '계획 1로 써줘'처럼 말하면 그 계획으로 써요."

/** 바로 쓴 원고가 정해 쓴 계획 한 줄. 반영 본문(stepText)과 섞지 않도록 따로 보인다. */
export const PLAN_LABEL = '사용한 계획'
export const usedPlan = (step: ChatStep) => (step.result?.plan ? `${PLAN_LABEL}: ${step.result.plan.title} — ${step.result.plan.beats.join(' / ')}` : '')

/** 바로 쓴 원고에 붙는 알림(설정 없이 쓴 이유 등, #523) 한 줄. 반영 본문(stepText)과 섞지 않도록 사용한 계획처럼 따로 보인다. */
export const draftNotice = (step: ChatStep) => (step.result?.text !== undefined && step.result.gaps?.length ? step.result.gaps.map((g) => `확인 못 함: ${g}`).join('\n') : '')

/**
 * 턴의 단계별 결과를 계획 순서로 이은 평문. 종합 답변(`reply.message`)은 넣지 않는다: 화면이 답변을 마크다운으로 그리고
 * 이 글은 그 아래에 접어 둔다(같은 내용 두 번 보이기 방지, #492). 답변도 단계도 없을 때만 안내 문구다.
 */
export function replyText(reply: ChatReply): string {
  const steps = reply.steps.filter((s) => s.status !== 'not_started')
    .map((s) => [`${stepLabel(s)} ${stepText(s)}`, s.status === 'completed' && usedPlan(s), s.status === 'completed' && draftNotice(s), appliedLine(s)].filter(Boolean).join('\n'))
  return steps.join('\n\n') || (reply.message ? '' : '응답 내용이 없어요.')
}

const stepLabel = (s: ChatStep) => `[${featureLabel[s.feature] ?? s.feature}]`
const appliedLine = (s: ChatStep) => (s.applied
  ? (s.feature === 'world' ? '→ 설정집 초안에 반영했어요.' : s.feature === 'content_action' ? '→ 승인한 작업을 실행했어요.' : s.task === 'revise_plan' ? '→ 계획에 저장했어요.' : `→ ${s.applied.episode}화 초안에 반영했어요.`)
  : s.approval === 'declined' ? (s.task === 'revise_plan' ? '→ 저장하지 않았어요.' : '→ 반영하지 않았어요.') : '')

/**
 * 실패 단계와 승인 결과(반영함·반영 안 함) 줄만. 종합 답변은 승인 전에 쓰여 승인·Content 반영 뒤에 달라진 이 결과를 말하지 못하므로
 * 화면은 단계별 결과를 접어도 이 줄은 접지 않는다. 문구는 replyText와 같다.
 */
export const replyOutcome = (reply: ChatReply): string[] =>
  reply.steps.flatMap((s) => [s.status === 'failed' ? `${stepLabel(s)} ${stepText(s)}` : '', appliedLine(s)].filter(Boolean))

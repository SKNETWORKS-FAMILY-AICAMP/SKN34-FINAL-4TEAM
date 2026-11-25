/** 목업 S.admin의 운영 데모 상태와 이벤트(EVENTS). 브라우저 메모리에만 있습니다. 공지는 운영 공지 API(NoticeRepository)가 맡습니다. */
type AdminUser = { id: string; nick: string; email: string; role: string; status: string; joined: string }
type AdminAccount = { id: string; nick: string; email: string; permissions: string[]; created: string }
/** 데모 조치 기록. at은 ISO 시각이며 활동 기록 탭(72)은 이를 메모리 AdminActivity로 바꿔 보여 줍니다. */
type AuditEntry = { at: string; actor: string; action: string; detail: string }
type Flagged = { id: string; title: string; owner: string; kind: string; rights: string; fork: string; reports: number; state: string; log: string[] }
export type AdminComment = { id: string; work: string; workId: string; author: string; text: string; likes: number; status: string }
type EventItem = { t: string; p: string; st: string; d: string; go: string; cta: string }

export type AdminState = {
  profile: { nick: string; email: string; joined: string }
  audit: AuditEntry[]
  users: AdminUser[]
  admins: AdminAccount[]
  flagged: Flagged
  /** 댓글 관리에서 숨긴 댓글 id (목업 A.comments[].status) */
  hiddenComments: string[]
  events: EventItem[]
}

/** 목업 ADMIN_PERMISSIONS */
export const ADMIN_PERMISSIONS: [string, string][] = [['works', '작품 관리'], ['users', '사용자 관리'], ['comments', '댓글 관리'], ['characterChats', '캐릭터챗'], ['feedback', '제보·문의 대응'], ['rights', '권리·신고 처리'], ['events', '이벤트 게시'], ['notices', '공지 게시'], ['llm', 'LLM Ops 조회'], ['jobs', '정기 작업'], ['credits', '크레딧 운영'], ['admins', '관리자 계정 관리']]

/** 목업 admin(): 알 수 없는 tab은 data, tab=ai는 llm */
export const ADMIN_TABS = ['data', 'users', 'works', 'comments', 'characterChats', 'feedback', 'events', 'notices', 'llm', 'rights', 'credits', 'audit', 'profile', 'jobs', 'admins', 'genres', 'worlds', 'cardCategories'] as const
export type AdminTab = (typeof ADMIN_TABS)[number]
export const adminTab = (t: string | null): AdminTab => ADMIN_TABS.find((x) => x === (t === 'ai' ? 'llm' : t)) ?? 'data'

/** LLM Ops의 세 쪽(사이드바 메뉴, 주소 `?tab=llm&view=`, #857): 에이전트 지표가 기본이라 view가 없거나 모르는 값도 에이전트 지표입니다. */
export const LLM_PAGES = [['metrics', '에이전트 지표'], ['prompts', '프롬프트·평가'], ['alerts', '경고·누설 감시']] as const
export type LlmPage = (typeof LLM_PAGES)[number][0]
/** 옮기거나 없앤 옛 주소: 추적·지표(traces)는 에이전트 지표로, 없앤 평가·누설 검사(quality)와 이슈가 적은 별칭 eval은 평가가 옮겨 간 프롬프트·평가로 이어집니다(누설 검사 기록은 경고·누설 감시에 있습니다). */
const MOVED_VIEWS = new Map<string, LlmPage>([['traces', 'metrics'], ['quality', 'prompts'], ['eval', 'prompts']])
export const llmPage = (v: string | null): LlmPage => LLM_PAGES.find(([page]) => page === v)?.[0] ?? MOVED_VIEWS.get(v ?? '') ?? 'metrics'
/** 에이전트 지표만 view가 없는 주소입니다. 운영 경고 알림·대시보드의 미확인 경고 카드는 `llmPageHref('alerts')`로 경고·누설 감시에 갑니다. */
export const llmPageHref = (page: LlmPage) => page === 'metrics' ? '/admin?tab=llm' : `/admin?tab=llm&view=${page}`

/** 에이전트 지표 쪽의 보기(주소 `&sub=`, #857): 지표(에이전트 카드·기본)·추적(추적 검색·상세는 지우지 않고 보기 전환으로 둔다). 없거나 모르는 값은 지표입니다. */
export const METRICS_SUBS = [['cards', '지표'], ['traces', '추적']] as const
export type MetricsSub = (typeof METRICS_SUBS)[number][0]
export const metricsSub = (v: string | null): MetricsSub => METRICS_SUBS.find(([sub]) => sub === v)?.[0] ?? 'cards'
/** 지표만 sub 없는 주소입니다. */
export const metricsSubHref = (sub: MetricsSub) => sub === 'cards' ? llmPageHref('metrics') : `${llmPageHref('metrics')}&sub=${sub}`

/** 프롬프트·평가 쪽의 보기(주소 `&sub=`, #857): 전체(AI 파이프라인, DEC-58)가 가장 왼쪽·기본이고 에이전트별 평가(입구)·프롬프트·모델이 이어집니다. 없거나 모르는 값은 전체입니다. */
export const PROMPT_SUBS = [['all', '전체(AI 파이프라인)'], ['evals', '에이전트별 평가'], ['prompts', '프롬프트'], ['models', '모델']] as const
export type PromptSub = (typeof PROMPT_SUBS)[number][0]
export const promptSub = (v: string | null): PromptSub => PROMPT_SUBS.find(([sub]) => sub === v)?.[0] ?? 'all'
/** 전체(AI 파이프라인)만 sub 없는 주소입니다. */
export const promptSubHref = (sub: PromptSub) => sub === 'all' ? llmPageHref('prompts') : `${llmPageHref('prompts')}&sub=${sub}`

/**
 * AI 파이프라인(전체) 보기의 워크플로우(주소 `&flow=`, #857 3차): 전체(서버 노드 흐름, 기본)와, 내부에 순서 있는 여러 LLM 단계가 있는 에이전트의 내부 흐름 하나씩입니다.
 * 사이드바 '프롬프트·평가' 아래 하위 탭이 이 목록 그대로입니다(3차 정정: 캔버스 위 선택 상자를 없앴습니다). 키가 주소에 남는 값이고 각 흐름의 단계·연결은 llmOpsFlows.ts에 있습니다. 없거나 모르는 값은 전체입니다.
 */
export const PIPELINE_FLOWS = [
  ['all', '전체'], ['simulation', '인물 시뮬레이션'], ['preprocessing', '원고 전처리'], ['review', '원고 검수'], ['research', '고증 조사'], ['writing', '기획·집필·수정'],
] as const
export type PipelineFlowKey = (typeof PIPELINE_FLOWS)[number][0]
export const pipelineFlowKey = (v: string | null): PipelineFlowKey => PIPELINE_FLOWS.find(([key]) => key === v)?.[0] ?? 'all'
/** 프롬프트·평가의 보기(sub)와 흐름 범위(flow)를 한 주소에 담습니다(#857). 전체(flow 없음)와 기본 보기(sub 없음)는 붙이지 않습니다. */
export const promptViewHref = (sub: PromptSub, flow: PipelineFlowKey) => flow === 'all' ? promptSubHref(sub) : `${promptSubHref(sub)}&flow=${flow}`
/** 파이프라인 보기의 흐름 주소(사이드바 하위 탭의 기본 링크, '내부 흐름 보기'). */
export const pipelineFlowHref = (flow: PipelineFlowKey) => promptViewHref('all', flow)

/**
 * 사이드바 '프롬프트·평가' 아래 하위 탭(워크플로우, #857 3차 정정)의 상태입니다(주소만으로 정해집니다). 하위 탭은 그 쪽에 있을 때만 펼쳐지고(open),
 * 켜진 하위 탭(current)은 흐름 범위(flow) 하나이고 전체 파이프라인·에이전트별 평가·프롬프트 보기에 적용됩니다. 모델 단가는 흐름과 무관해 펼쳐지기만 하고 켜진 하위 탭이 없습니다.
 */
export function promptNavState(tab: AdminTab, page: LlmPage, sub: string | null, flow: string | null): { open: boolean; current: PipelineFlowKey | null } {
  const open = tab === 'llm' && page === 'prompts'
  return { open, current: open && promptSub(sub) !== 'models' ? pipelineFlowKey(flow) : null }
}

/** 로그인 복귀에는 알려진 내부 관리자 탭 하나만 남깁니다. 임의 next/외부 URL은 전달하지 않습니다. */
export function adminReturnPath(search: string): string {
  const query = new URLSearchParams(search)
  if (!query.has('tab')) return '/admin'
  const tab = adminTab(query.get('tab'))
  // LLM Ops는 알려진 쪽(view, 옮기거나 없앤 옛 주소는 새 위치)도 남기고, 프롬프트·평가·에이전트 지표 쪽은 알려진 보기(sub)도 남깁니다(없거나 모르는 값은 에이전트 지표·전체(AI 파이프라인)·지표).
  if (tab !== 'llm') return `/admin?tab=${tab}`
  const page = llmPage(query.get('view'))
  if (page === 'prompts') {
    const sub = promptSub(query.get('sub'))
    return sub === 'models' ? promptSubHref(sub) : promptViewHref(sub, pipelineFlowKey(query.get('flow')))   // 흐름 범위는 모델 보기를 뺀 모든 보기에 남긴다
  }
  return page === 'metrics' ? metricsSubHref(metricsSub(query.get('sub'))) : llmPageHref(page)
}

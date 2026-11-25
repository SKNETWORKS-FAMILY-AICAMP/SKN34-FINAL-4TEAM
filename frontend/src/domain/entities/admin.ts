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

/** LLM Ops의 네 쪽(사이드바 메뉴, 주소 `?tab=llm&view=`): 경고가 기본이라 view가 없거나 모르는 값도 경고입니다. */
export const LLM_PAGES = [['alerts', '경고'], ['traces', '추적·지표'], ['prompts', '프롬프트·모델'], ['quality', '평가·누설 검사']] as const
export type LlmPage = (typeof LLM_PAGES)[number][0]
export const llmPage = (v: string | null): LlmPage => LLM_PAGES.find(([page]) => page === v)?.[0] ?? 'alerts'
/** 경고만 view가 없는 주소입니다(운영 경고 알림·개요 카드가 쓰는 `/admin?tab=llm`이 그대로 경고로 갑니다). */
export const llmPageHref = (page: LlmPage) => page === 'alerts' ? '/admin?tab=llm' : `/admin?tab=llm&view=${page}`

/** 프롬프트·모델 쪽의 보기(DEC-58, 주소 `&sub=`): 전체(AI 파이프라인)·프롬프트·모델. 없거나 모르는 값은 전체입니다. */
export const PROMPT_SUBS = [['all', '전체'], ['prompts', '프롬프트'], ['models', '모델']] as const
export type PromptSub = (typeof PROMPT_SUBS)[number][0]
export const promptSub = (v: string | null): PromptSub => PROMPT_SUBS.find(([sub]) => sub === v)?.[0] ?? 'all'
/** 전체만 sub 없는 주소입니다. */
export const promptSubHref = (sub: PromptSub) => sub === 'all' ? llmPageHref('prompts') : `${llmPageHref('prompts')}&sub=${sub}`

/** 로그인 복귀에는 알려진 내부 관리자 탭 하나만 남깁니다. 임의 next/외부 URL은 전달하지 않습니다. */
export function adminReturnPath(search: string): string {
  const query = new URLSearchParams(search)
  if (!query.has('tab')) return '/admin'
  const tab = adminTab(query.get('tab'))
  // LLM Ops는 알려진 쪽(view)도 남기고, 프롬프트·모델 쪽은 알려진 보기(sub)도 남깁니다(없거나 모르는 값은 경고·전체).
  if (tab !== 'llm') return `/admin?tab=${tab}`
  const page = llmPage(query.get('view'))
  return page === 'prompts' ? promptSubHref(promptSub(query.get('sub'))) : llmPageHref(page)
}

/** 목업 S.admin의 운영 데모 상태와 이벤트(EVENTS). 브라우저 메모리에만 있습니다. 공지는 운영 공지 API(NoticeRepository)가 맡습니다. */
type AdminUser = { id: string; nick: string; email: string; role: string; status: string; joined: string }
type AdminJob = { id: string; name: string; status: string; last: string }
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
  jobs: AdminJob[]
  admins: AdminAccount[]
  flagged: Flagged
  /** 댓글 관리에서 숨긴 댓글 id (목업 A.comments[].status) */
  hiddenComments: string[]
  events: EventItem[]
}

/** 목업 ADMIN_PERMISSIONS */
export const ADMIN_PERMISSIONS: [string, string][] = [['works', '작품 관리'], ['users', '사용자 관리'], ['comments', '댓글 관리'], ['characterChats', '캐릭터챗'], ['feedback', '제보·문의 대응'], ['rights', '권리·신고 처리'], ['events', '이벤트 게시'], ['notices', '공지 게시'], ['llm', 'LLM Ops 조회'], ['jobs', '정기 작업'], ['credits', '크레딧 운영'], ['admins', '관리자 계정 관리']]

/** 목업 admin(): 알 수 없는 tab은 data, tab=ai는 llm */
export const ADMIN_TABS = ['data', 'users', 'works', 'comments', 'characterChats', 'feedback', 'events', 'notices', 'llm', 'rights', 'credits', 'audit', 'profile', 'jobs', 'admins'] as const
export type AdminTab = (typeof ADMIN_TABS)[number]
export const adminTab = (t: string | null): AdminTab => ADMIN_TABS.find((x) => x === (t === 'ai' ? 'llm' : t)) ?? 'data'

/**
 * 로그인 뒤 전체 페이지 이동으로 돌아갈 Core OIDC 인가 주소(Langfuse 로그인, DEC-55)입니다. 이 경로만 허용하고 그 밖(외부 주소·다른 경로)은 null이며,
 * 주소는 가짜 기준 주소로 해석한 결과(점 경로·인코딩 정리 뒤)가 같은 출처의 이 경로일 때만 인정합니다.
 */
export function oidcAuthorizeReturn(next: string | null): string | null {
  if (!next) return null
  const base = 'http://return.invalid'
  let url: URL
  try { url = new URL(next, base) } catch { return null }
  return url.origin === base && url.pathname === '/api/v1/auth/oidc/authorize' ? url.pathname + url.search : null
}

/** 로그인 복귀에는 알려진 내부 관리자 탭 하나만 남깁니다. 임의 next/외부 URL은 전달하지 않습니다. */
export function adminReturnPath(search: string): string {
  const query = new URLSearchParams(search)
  return query.has('tab') ? `/admin?tab=${adminTab(query.get('tab'))}` : '/admin'
}

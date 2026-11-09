/** 목업 S.admin의 운영 데모 상태와 이벤트(EVENTS). 브라우저 메모리에만 있습니다. 공지는 운영 공지 API(NoticeRepository)가 맡습니다. */
type AdminUser = { id: string; nick: string; email: string; role: string; status: string; joined: string }
type AdminJob = { id: string; name: string; status: string; last: string }
type AdminAccount = { id: string; nick: string; email: string; permissions: string[]; created: string }
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

/** 로그인 복귀에는 알려진 내부 관리자 탭 하나만 남깁니다. 임의 next/외부 URL은 전달하지 않습니다. */
export function adminReturnPath(search: string): string {
  const query = new URLSearchParams(search)
  return query.has('tab') ? `/admin?tab=${adminTab(query.get('tab'))}` : '/admin'
}

export const today = () => new Intl.DateTimeFormat('sv-SE').format(new Date()).replaceAll('-', '.')

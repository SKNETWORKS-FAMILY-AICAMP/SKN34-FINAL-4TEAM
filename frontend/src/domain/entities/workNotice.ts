import { isMine, type Role, type Work } from './work'

/** 작품 소식 분류(계약 category)와 화면 이름 */
export const NOTICE_CATEGORIES = [['info', '안내'], ['hiatus', '휴재'], ['event', '이벤트']] as const
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number][0]

/** Content 작품 소식(계약 WorkNoticeResponse). 시각은 UTC ISO-8601이다. 사이트 전체 공지(운영 공지)와 다르다. */
export type WorkNotice = {
  id: string
  workId: string
  category: NoticeCategory
  title: string
  body: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}
/** 작성·수정 요청(계약 WorkNoticeRequest). 수정은 전체 교체라 고정 여부도 함께 보낸다. */
export type WorkNoticeInput = Pick<WorkNotice, 'category' | 'title' | 'body' | 'pinned'>

/** 요청 본문에 필요한 네 필드만 뽑는다(WorkNotice를 그대로 넘겨도 id·시각이 요청에 섞이지 않게). */
export const noticeInput = ({ category, title, body, pinned }: WorkNoticeInput): WorkNoticeInput => ({ category, title, body, pinned })

/** 제목·본문(앞뒤 공백 제외)의 최대 글자 수 */
export const NOTICE_TITLE_MAX = 200
export const NOTICE_BODY_MAX = 20000

/** 입력 안내 문구(통과하면 null). 서버와 같이 앞뒤 공백을 지운 제목 1~200자, 본문 1~20,000자다. */
export function noticeInputError({ title, body }: Pick<WorkNoticeInput, 'title' | 'body'>) {
  const t = title.trim()
  const b = body.trim()
  if (!t) return '소식 제목을 입력해 주세요.'
  if (t.length > NOTICE_TITLE_MAX) return `소식 제목은 ${NOTICE_TITLE_MAX}자까지 쓸 수 있어요.`
  if (!b) return '소식 내용을 입력해 주세요.'
  if (b.length > NOTICE_BODY_MAX) return `소식 내용은 ${NOTICE_BODY_MAX.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`
  return null
}

/**
 * 소식 관리(작성·수정·고정·삭제) 버튼 노출: 작품 소유자(내 작품이거나 서버 소유자 ID가 내 ID)와 운영자.
 * 버튼을 숨기는 것은 표시일 뿐이고 권한은 서버가 다시 확인한다.
 */
export const canManageNotices = (w: Work, role: Role, memberId: string | null) => isMine(w) || (memberId !== null && w.owner === memberId) || role === 'admin'

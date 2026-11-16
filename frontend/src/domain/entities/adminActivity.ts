import { ADMIN_PERMISSIONS } from './admin'
import { REPORT_STATUSES, reportStatusLabel, type ReportStatus } from './report'

/** 관리자 활동 기록(72). 정본은 운영 서비스이며 삽입 전용입니다. 수행자 닉네임은 조회 때 Core 관리자 목록에서 채우고, 목록에 없으면 null입니다. */
export type AdminActivity = {
  id: string
  actorId: string
  actorNickname: string | null
  /** 계약의 조치 코드(예: MEMBER_RESTRICT). 새 코드가 생겨도 받아 보여 줄 수 있게 문자열로 둡니다. */
  action: string
  targetType: string
  targetId: string
  detail: string | null
  createdAt: string
}

// Map이라 'toString' 같은 객체 기본 속성 이름이 라벨 대신 함수로 새지 않습니다.
const ACTIONS = new Map([
  ['MEMBER_RESTRICT', '회원 이용 제한'], ['MEMBER_UNRESTRICT', '회원 이용 제한 해제'],
  ['ADMIN_CREATE', '관리자 계정 생성'],
  ['REPORT_REVIEW', '신고 검토'], ['REPORT_REQUEST_EVIDENCE', '권리 증빙 요청'],
  ['REPORT_RESTRICT', '신고 대상 작품 제한'], ['REPORT_UNRESTRICT', '신고 대상 작품 제한 해제'],
  ['WORK_RESTRICT', '작품 운영 제한'], ['WORK_UNRESTRICT', '작품 운영 제한 해제'],
  ['NOTICE_CREATE', '공지 등록'], ['NOTICE_UPDATE', '공지 수정'], ['NOTICE_DELETE', '공지 삭제'],
  ['EVENT_CREATE', '이벤트 등록'], ['EVENT_UPDATE', '이벤트 수정'], ['EVENT_DELETE', '이벤트 삭제'],
  ['INQUIRY_REPLY_CREATE', '문의 답변 등록'], ['INQUIRY_REPLY_UPDATE', '문의 답변 수정'], ['INQUIRY_REPLY_DELETE', '문의 답변 삭제'],
  ['COMMENT_HIDE', '댓글 숨김'], ['COMMENT_UNHIDE', '댓글 게시 복구'],
])
const TARGETS = new Map([['MEMBER', '회원'], ['REPORT', '신고'], ['WORK', '작품'], ['NOTICE', '공지'], ['EVENT', '이벤트'], ['INQUIRY', '문의'], ['COMMENT', '댓글']])

/** 모르는 조치는 코드 그대로 보여 줍니다. */
export const activityActionLabel = (action: string) => ACTIONS.get(action) ?? action
/** 대상은 "종류 이름 ID"입니다. 모르는 종류는 코드 그대로, ID가 없으면 종류만 보여 줍니다. */
export const activityTarget = ({ targetType, targetId }: Pick<AdminActivity, 'targetType' | 'targetId'>) =>
  [TARGETS.get(targetType) ?? targetType, targetId].filter(Boolean).join(' ')
/** 수행자는 닉네임이고, 관리자 해제·탈퇴로 닉네임이 없으면 ID입니다. */
export const activityActor = ({ actorId, actorNickname }: Pick<AdminActivity, 'actorId' | 'actorNickname'>) => actorNickname || actorId

const PERMISSIONS = new Map(ADMIN_PERMISSIONS)
/** 내역이 답변 ID뿐이라 사람이 읽을 정보가 없는 조치 */
const ID_ONLY = new Set(['INQUIRY_REPLY_CREATE', 'INQUIRY_REPLY_UPDATE', 'INQUIRY_REPLY_DELETE'])
const isReportStatus = (value: string): value is ReportStatus => REPORT_STATUSES.some(([status]) => status === value)

/**
 * 내역 줄: 서버가 조치별로 남긴 짧은 값을 사람이 읽는 문구로 바꿉니다. 신고 검토는 결정 상태 이름으로, 관리자 계정 생성(`이메일 · 권한 키,…`)은
 * 권한 이름으로 보입니다. 문의 답변 조치는 답변 ID뿐이라 감추고, 보일 내용이 없으면 null입니다. 모르는 값은 그대로 보입니다.
 */
export function activityDetail({ action, detail }: Pick<AdminActivity, 'action' | 'detail'>): string | null {
  if (!detail || ID_ONLY.has(action)) return null
  if (action === 'REPORT_REVIEW') return isReportStatus(detail) ? reportStatusLabel(detail) : detail
  if (action === 'ADMIN_CREATE') {
    const [email, keys] = detail.split(' · ')
    if (keys === undefined) return detail
    return `${email} · ${keys.split(',').filter(Boolean).map((key) => PERMISSIONS.get(key) ?? key).join(', ') || '없음'}`
  }
  return detail
}

/** 활동 기록 조회는 `admins` 권한(화면 이름 '관리자 계정 관리')이 있어야 합니다. 403이면 다시 시도 대신 이 안내를 보입니다. */
export const ACTIVITY_FORBIDDEN = "활동 로그를 보려면 '관리자 계정 관리' 권한이 필요해요."

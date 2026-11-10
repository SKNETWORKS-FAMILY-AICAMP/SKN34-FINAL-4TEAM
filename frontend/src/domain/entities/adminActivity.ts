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
])
const TARGETS = new Map([['MEMBER', '회원'], ['REPORT', '신고'], ['WORK', '작품'], ['NOTICE', '공지'], ['EVENT', '이벤트'], ['INQUIRY', '문의']])

/** 모르는 조치는 코드 그대로 보여 줍니다. */
export const activityActionLabel = (action: string) => ACTIONS.get(action) ?? action
/** 대상은 "종류 이름 ID"입니다. 모르는 종류는 코드 그대로, ID가 없으면 종류만 보여 줍니다. */
export const activityTarget = ({ targetType, targetId }: Pick<AdminActivity, 'targetType' | 'targetId'>) =>
  [TARGETS.get(targetType) ?? targetType, targetId].filter(Boolean).join(' ')
/** 수행자는 닉네임이고, 관리자 해제·탈퇴로 닉네임이 없으면 ID입니다. */
export const activityActor = ({ actorId, actorNickname }: Pick<AdminActivity, 'actorId' | 'actorNickname'>) => actorNickname || actorId

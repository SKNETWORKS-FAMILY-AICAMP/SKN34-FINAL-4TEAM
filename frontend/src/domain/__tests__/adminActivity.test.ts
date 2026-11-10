import { describe, expect, it } from 'vitest'

import { activityActionLabel, activityActor, activityTarget } from '../entities/adminActivity'

/** 계약(operations-admin-activity-contract)의 action 18종 */
const ACTIONS: [string, string][] = [
  ['MEMBER_RESTRICT', '회원 이용 제한'], ['MEMBER_UNRESTRICT', '회원 이용 제한 해제'],
  ['ADMIN_CREATE', '관리자 계정 생성'],
  ['REPORT_REVIEW', '신고 검토'], ['REPORT_REQUEST_EVIDENCE', '권리 증빙 요청'],
  ['REPORT_RESTRICT', '신고 대상 작품 제한'], ['REPORT_UNRESTRICT', '신고 대상 작품 제한 해제'],
  ['WORK_RESTRICT', '작품 운영 제한'], ['WORK_UNRESTRICT', '작품 운영 제한 해제'],
  ['NOTICE_CREATE', '공지 등록'], ['NOTICE_UPDATE', '공지 수정'], ['NOTICE_DELETE', '공지 삭제'],
  ['EVENT_CREATE', '이벤트 등록'], ['EVENT_UPDATE', '이벤트 수정'], ['EVENT_DELETE', '이벤트 삭제'],
  ['INQUIRY_REPLY_CREATE', '문의 답변 등록'], ['INQUIRY_REPLY_UPDATE', '문의 답변 수정'], ['INQUIRY_REPLY_DELETE', '문의 답변 삭제'],
]

describe('관리자 활동 기록 표시 규칙 (72)', () => {
  it('계약의 조치 18종은 모두 한국어 이름으로 보인다', () => {
    expect(ACTIONS).toHaveLength(18)
    for (const [code, label] of ACTIONS) expect(activityActionLabel(code)).toBe(label)
  })

  it('모르는 조치는 코드 그대로 보이고 객체 기본 속성 이름도 함수로 새지 않는다', () => {
    expect(activityActionLabel('FUTURE_ACTION')).toBe('FUTURE_ACTION')
    expect(activityActionLabel('toString')).toBe('toString')
  })

  it('대상은 종류 이름과 ID로 보이고 모르는 종류는 코드 그대로, ID가 없으면 종류만 보인다', () => {
    const target = (targetType: string, targetId: string) => activityTarget({ targetType, targetId })
    expect(target('MEMBER', 'm-1')).toBe('회원 m-1')
    expect(target('REPORT', 'r-1')).toBe('신고 r-1')
    expect(target('WORK', 'w-1')).toBe('작품 w-1')
    expect(target('NOTICE', 'n-1')).toBe('공지 n-1')
    expect(target('EVENT', 'e-1')).toBe('이벤트 e-1')
    expect(target('INQUIRY', 'q-1')).toBe('문의 q-1')
    expect(target('FUTURE', 'f-1')).toBe('FUTURE f-1')
    expect(target('toString', 'x')).toBe('toString x')
    expect(target('FUTURE', '')).toBe('FUTURE')
  })

  it('수행자는 닉네임으로 보이고 닉네임이 없으면(해제·탈퇴한 관리자) ID로 보인다', () => {
    expect(activityActor({ actorId: 'admin-1', actorNickname: '운영자' })).toBe('운영자')
    expect(activityActor({ actorId: 'admin-1', actorNickname: null })).toBe('admin-1')
    expect(activityActor({ actorId: 'admin-1', actorNickname: '' })).toBe('admin-1')
  })
})

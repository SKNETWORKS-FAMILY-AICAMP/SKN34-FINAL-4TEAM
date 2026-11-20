import { describe, expect, it } from 'vitest'

import { ADMIN_PERMISSIONS } from '../entities/admin'
import { ACTIVITY_FORBIDDEN, activityActionLabel, activityActor, activityDetail, activityTarget } from '../entities/adminActivity'

/** 계약(operations-admin-activity-contract)의 action 20종 */
const ACTIONS: [string, string][] = [
  ['MEMBER_RESTRICT', '회원 이용 제한'], ['MEMBER_UNRESTRICT', '회원 이용 제한 해제'],
  ['ADMIN_CREATE', '관리자 계정 생성'],
  ['REPORT_REVIEW', '신고 검토'], ['REPORT_REQUEST_EVIDENCE', '권리 증빙 요청'],
  ['REPORT_RESTRICT', '신고 대상 작품 제한'], ['REPORT_UNRESTRICT', '신고 대상 작품 제한 해제'],
  ['WORK_RESTRICT', '작품 운영 제한'], ['WORK_UNRESTRICT', '작품 운영 제한 해제'],
  ['NOTICE_CREATE', '공지 등록'], ['NOTICE_UPDATE', '공지 수정'], ['NOTICE_DELETE', '공지 삭제'],
  ['EVENT_CREATE', '이벤트 등록'], ['EVENT_UPDATE', '이벤트 수정'], ['EVENT_DELETE', '이벤트 삭제'],
  ['INQUIRY_REPLY_CREATE', '문의 답변 등록'], ['INQUIRY_REPLY_UPDATE', '문의 답변 수정'], ['INQUIRY_REPLY_DELETE', '문의 답변 삭제'],
  ['COMMENT_HIDE', '댓글 숨김'], ['COMMENT_UNHIDE', '댓글 게시 복구'],
]

/** DEC-55 관리자 변경 조치 12종: LLMOps 8종은 조각 2 서버 코드의 이름, 작업 감시 4종(JOB_*)은 조각 3이 확정한 이름이다. EVALUATION_REQUIRED는 조치가 아니라 승격의 409 오류 code라 여기에 없다 */
const LLMOPS_ACTIONS: [string, string][] = [
  ['PROMPT_CREATE', '프롬프트 버전 등록'], ['PROMPT_PROMOTE', '프롬프트 승격·복원'], ['MODEL_CREATE', '모델 등록'], ['EVALUATION_RUN', '회귀 평가 실행'],
  ['ALERT_ACKNOWLEDGE', '경고 확인'], ['ALERT_RESOLVE', '경고 조치 완료'], ['ALERT_RULE_UPDATE', '경고 기준 변경'], ['LLMOPS_SETTING_UPDATE', 'LLMOps 설정 변경'],
  ['JOB_SCHEDULE_CREATE', '정기 작업 일정 등록'], ['JOB_SCHEDULE_UPDATE', '정기 작업 일정 변경'], ['JOB_SCHEDULE_CANCEL', '정기 작업 일정 취소'], ['JOB_RETRY', '작업 실패 재실행'],
]

describe('관리자 활동 기록 표시 규칙 (72)', () => {
  it('계약의 조치 20종은 모두 한국어 이름으로 보인다', () => {
    expect(ACTIONS).toHaveLength(20)
    for (const [code, label] of ACTIONS) expect(activityActionLabel(code)).toBe(label)
  })

  it('운영 대시보드·LLMOps·작업 감시의 조치 12종도 한국어 이름으로 보인다', () => {
    expect(LLMOPS_ACTIONS).toHaveLength(12)
    for (const [code, label] of LLMOPS_ACTIONS) expect(activityActionLabel(code)).toBe(label)
  })

  it('장르 관리 조치 3종(DEC-56)도 한국어 이름으로 보이고 대상은 장르 코드, 순서 변경은 장르 목록으로 보인다', () => {
    expect([['GENRE_CREATE', '장르 추가'], ['GENRE_UPDATE', '장르 수정'], ['GENRE_REORDER', '장르 순서 변경']].map(([code]) => activityActionLabel(code))).toEqual(['장르 추가', '장르 수정', '장르 순서 변경'])
    expect(activityTarget({ targetType: 'GENRE', targetId: 'genre-31' })).toBe('장르 genre-31')
    expect(activityTarget({ targetType: 'GENRE', targetId: 'order' })).toBe('장르 목록')
    expect(activityDetail({ action: 'GENRE_CREATE', detail: '사이버펑크' })).toBe('사이버펑크')
    expect(activityDetail({ action: 'GENRE_REORDER', detail: 'genre-02,genre-01,genre-03' })).toBe('3개 장르의 순서')
    expect(activityDetail({ action: 'GENRE_REORDER', detail: null })).toBeNull()
  })

  it('모르는 조치는 코드 그대로 보이고 객체 기본 속성 이름도 함수로 새지 않는다', () => {
    expect(activityActionLabel('FUTURE_ACTION')).toBe('FUTURE_ACTION')
    expect(activityActionLabel('toString')).toBe('toString')
  })

  it('대상은 종류 이름과 ID로 보이고 모르는 종류는 코드 그대로, ID가 없으면 종류만 보인다', () => {
    const target = (targetType: string, targetId: string) => activityTarget({ targetType, targetId })
    expect(target('MEMBER', 'm-1')).toBe('회원 m-1')
    expect(target('COMMENT', 'c-1')).toBe('댓글 c-1')
    expect(target('REPORT', 'r-1')).toBe('신고 r-1')
    expect(target('WORK', 'w-1')).toBe('작품 w-1')
    expect(target('NOTICE', 'n-1')).toBe('공지 n-1')
    expect(target('EVENT', 'e-1')).toBe('이벤트 e-1')
    expect(target('INQUIRY', 'q-1')).toBe('문의 q-1')
    expect(target('JOB_SCHEDULE', 's-1')).toBe('정기 작업 일정 s-1')
    expect(target('JOB_RUN', 'j-1')).toBe('작업 실행 j-1')
    expect(target('PROMPT', 'qa-answer')).toBe('프롬프트 qa-answer')
    expect(target('MODEL', 'm-1')).toBe('모델 m-1')
    expect(target('EVALUATION', 'r-1')).toBe('회귀 평가 r-1')
    expect(target('ALERT', 'a-1')).toBe('경고 a-1')
    expect(target('ALERT_RULE', 'ai_failure_rate')).toBe('경고 기준 ai_failure_rate')
    expect(target('LLMOPS_SETTING', 'leak_sample_rate')).toBe('LLMOps 설정 leak_sample_rate')
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

describe('관리자 활동 기록 내역 표시 (72)', () => {
  const detail = (action: string, text: string | null) => activityDetail({ action, detail: text })

  it('신고 검토 내역은 결정 상태를 한국어로 보이고 모르는 값은 그대로 보인다', () => {
    expect(detail('REPORT_REVIEW', 'ACCEPTED')).toBe('신고 인정')
    expect(detail('REPORT_REVIEW', 'REJECTED')).toBe('기각')
    expect(detail('REPORT_REVIEW', 'FUTURE')).toBe('FUTURE')
  })

  it('관리자 계정 생성 내역은 권한 키를 한국어 권한 이름으로 바꿔 보이고 모르는 키는 그대로, 권한이 없으면 없음으로 보인다', () => {
    expect(detail('ADMIN_CREATE', 'new@example.invalid · works,notices,admins')).toBe('new@example.invalid · 작품 관리, 공지 게시, 관리자 계정 관리')
    expect(detail('ADMIN_CREATE', 'a@example.invalid · works,future,toString')).toBe('a@example.invalid · 작품 관리, future, toString')
    expect(detail('ADMIN_CREATE', 'a@example.invalid · ')).toBe('a@example.invalid · 없음')
    // 형식이 다른 내역은 가공하지 않고 그대로 보인다.
    expect(detail('ADMIN_CREATE', 'a@example.invalid')).toBe('a@example.invalid')
  })

  it('문의 답변 조치의 내역은 답변 ID뿐이라 보이지 않는다', () => {
    for (const action of ['INQUIRY_REPLY_CREATE', 'INQUIRY_REPLY_UPDATE', 'INQUIRY_REPLY_DELETE']) {
      expect(detail(action, '3f2c9a10-0000-4000-8000-000000000001')).toBeNull()
    }
  })

  it('그 밖의 조치는 서버가 남긴 내역을 그대로 보이고 내역이 없으면 보이지 않는다', () => {
    expect(detail('WORK_RESTRICT', '별빛 서약의 탑')).toBe('별빛 서약의 탑')
    expect(detail('FUTURE_ACTION', '새 조치 내역')).toBe('새 조치 내역')
    expect(detail('NOTICE_DELETE', null)).toBeNull()
    expect(detail('WORK_RESTRICT', '')).toBeNull()
  })

  it('활동 기록을 볼 수 없을 때의 안내는 조회에 필요한 관리자 계정 관리 권한 이름을 쓴다', () => {
    expect(ACTIVITY_FORBIDDEN).toBe("활동 로그를 보려면 '관리자 계정 관리' 권한이 필요해요.")
    expect(ADMIN_PERMISSIONS).toContainEqual(['admins', '관리자 계정 관리'])
  })
})

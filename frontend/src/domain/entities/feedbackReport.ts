import type { FeedbackType } from './feedback'

/** Content 제보(계약 ReportResponse). 목업 데모의 ReaderReport(feedback.ts)·운영 신고(report.ts)와 별개다. */
export const FEEDBACK_REPORT_KINDS = ['typo', 'story', 'question', 'suggestion'] as const
export type FeedbackReportKind = (typeof FEEDBACK_REPORT_KINDS)[number]
export const FEEDBACK_REPORT_STATUSES = ['unchecked', 'checked', 'answered', 'resolved', 'closed'] as const
export type FeedbackReportStatus = (typeof FEEDBACK_REPORT_STATUSES)[number]
export type FeedbackReportVisibility = 'public' | 'private'

/** 제보자의 정정(correct, 본문 있음)·철회(withdraw, 본문 없음) 기록 */
export type FeedbackReportAmendment = { action: 'correct' | 'withdraw'; body: string | null; createdAt: string }
/** 작가의 답변. 공개 답변만 제보자·작가 밖의 사람에게 보인다. */
export type FeedbackReportReply = { id: string; authorName: string; body: string; isPublic: boolean; createdAt: string }

export type FeedbackReport = {
  id: string
  workId: string
  workTitle: string
  episodeNumber: number
  /** 등록 시점의 발행 버전. 이후 발행본이 바뀌어도 그대로다. */
  publishedVersionId: string
  kind: FeedbackReportKind
  /** 원문을 볼 권한이 없는 비공개 제보(공개 답변만 노출)는 null */
  body: string | null
  quote: string | null
  visibility: FeedbackReportVisibility
  status: FeedbackReportStatus
  /** 원문을 볼 수 없으면 null */
  reporterName: string | null
  /** 요청자가 제보자 */
  mine: boolean
  /** 요청자가 작품 소유자 */
  owner: boolean
  authorChecked: boolean
  withdrawn: boolean
  amendments: FeedbackReportAmendment[]
  responses: FeedbackReportReply[]
  createdAt: string
  updatedAt: string
}

/** 문장 피드백 시트의 한글 유형과 서버 유형의 대응 */
export const REPORT_KIND_OF: Record<FeedbackType, FeedbackReportKind> = { '단순 오류': 'typo', '스토리 오류': 'story', 질문: 'question', 제안: 'suggestion' }
export const REPORT_KIND_LABEL: Record<FeedbackReportKind, string> = { typo: '단순 오류', story: '스토리 오류', question: '질문', suggestion: '제안' }
export const REPORT_STATUS_LABEL: Record<FeedbackReportStatus, string> = { unchecked: '작가 확인 전', checked: '확인함', answered: '답변함', resolved: '처리 완료', closed: '종료' }
export const REPORT_VISIBILITY_LABEL: Record<FeedbackReportVisibility, string> = { public: '공개', private: '비공개' }
/** 작가가 바꿀 수 있는 처리 상태. 확인 전으로 되돌릴 수 없다(계약). */
export const SETTABLE_REPORT_STATUSES = ['checked', 'answered', 'resolved', 'closed'] as const satisfies readonly FeedbackReportStatus[]
export type SettableReportStatus = (typeof SETTABLE_REPORT_STATUSES)[number]

/** 상태 칩 색: 작가 확인 전·확인함은 진행 중(wait), 답변함·처리 완료는 완료(ok), 종료는 중립 */
export const reportStatusChip = (status: FeedbackReportStatus) => (status === 'unchecked' || status === 'checked' ? 'wait' : status === 'closed' ? '' : 'ok')

/** 제보 본문·정정 본문·인용 문장의 최대 글자 수 */
export const REPORT_BODY_MAX = 500
/** 작가 답변의 최대 글자 수 */
export const REPORT_RESPONSE_MAX = 2000

/** 앞뒤 공백을 지운 글자 수가 0이면 empty, max를 넘으면 over 안내를 돌려주고 통과하면 null이다. */
const textError = (body: string, max: number, empty: string, over: string) => {
  const length = body.trim().length
  return length === 0 ? empty : length > max ? over : null
}

/** 제보 입력의 안내 문구(통과하면 null). 본문은 앞뒤 공백을 지운 뒤 1~500자, 인용 문장은 500자 이하다(계약). */
export const reportInputError = (body: string, quote?: string | null) =>
  textError(body, REPORT_BODY_MAX, '제보 내용을 입력해 주세요.', `제보는 ${REPORT_BODY_MAX}자까지 보낼 수 있어요.`)
  ?? (quote && quote.trim().length > REPORT_BODY_MAX ? `선택한 문장이 ${REPORT_BODY_MAX}자를 넘어 제보에 붙일 수 없어요.` : null)

/** 정정 입력의 안내 문구(통과하면 null). 제보 본문과 같은 1~500자다. */
export const correctionInputError = (body: string) =>
  textError(body, REPORT_BODY_MAX, '정정 내용을 입력해 주세요.', `정정은 ${REPORT_BODY_MAX}자까지 보낼 수 있어요.`)

/** 작가 답변 입력의 안내 문구(통과하면 null). 앞뒤 공백을 지운 뒤 1~2000자다. */
export const responseInputError = (body: string) =>
  textError(body, REPORT_RESPONSE_MAX, '답변 내용을 입력해 주세요.', `답변은 ${REPORT_RESPONSE_MAX}자까지 보낼 수 있어요.`)

/** 운영 신고 사건(34). 정본은 운영 서비스이며 실제 작품 제한은 Content가 수행합니다. */
export type ReportKind = 'RIGHTS' | 'HARMFUL'
export type ReportStatus = 'RECEIVED' | 'ACCEPTED' | 'REJECTED'
export type ReviewDecision = 'ACCEPTED' | 'REJECTED'
export type ReportHistory = { id: string; type: string; actorId: string; body: string | null; createdAt: string }
export type Report = {
  id: string
  kind: ReportKind
  workId: string
  workTitle: string
  workOwnerId: string
  reporterId: string
  reason: string
  evidence: string
  status: ReportStatus
  contentRestricted: boolean
  createdAt: string
  updatedAt: string
  /** 상세 조회에만 있으며 오래된순입니다. */
  history?: ReportHistory[]
}
export type ReportInput = { kind: ReportKind; workId: string; reason: string; evidence: string }

export const REPORT_KINDS: [ReportKind, string][] = [['RIGHTS', '권리 침해'], ['HARMFUL', '유해 콘텐츠']]
export const REPORT_STATUSES: [ReportStatus, string][] = [['RECEIVED', '접수'], ['ACCEPTED', '신고 인정'], ['REJECTED', '기각']]
const HISTORY_LABELS: Record<string, string> = {
  EVIDENCE: '증거 보완', EXPLANATION: '작가 소명', REVIEW: '검토 결과', RESTRICT: '콘텐츠 제한',
  UNRESTRICT: '제한 해제', EVIDENCE_REQUEST: '권리 증빙 요청',
}
export const reportKindLabel = (kind: ReportKind) => REPORT_KINDS.find(([k]) => k === kind)?.[1] ?? kind
export const reportStatusLabel = (status: ReportStatus) => REPORT_STATUSES.find(([s]) => s === status)?.[1] ?? status
export const historyLabel = (type: string) => HISTORY_LABELS[type] ?? type

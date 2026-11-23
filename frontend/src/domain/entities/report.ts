/** 운영 신고 사건(34). 정본은 운영 서비스이며 실제 작품 제한은 Content가 수행합니다. */
export type ReportKind = 'RIGHTS' | 'HARMFUL'
export type ReportStatus = 'RECEIVED' | 'ACCEPTED' | 'REJECTED'
export type ReviewDecision = 'ACCEPTED' | 'REJECTED'
/** 신고 대상 종류(결정 D): 작품 전체·한 회차·공개 세계관. 처리의 제한·해제는 그 대상에 적용된다. */
export type ReportTargetType = 'work' | 'episode' | 'world'
export type ReportHistory = { id: string; type: string; actorId: string; body: string | null; createdAt: string }
export type Report = {
  id: string
  kind: ReportKind
  targetType: ReportTargetType
  /** 세계관 신고는 작품 없이 접수돼 null이다. */
  workId: string | null
  workTitle: string | null
  workOwnerId: string | null
  /** 회차 신고일 때만 있다. */
  episodeNumber: number | null
  /** 세계관 신고일 때만 있다. */
  worldId: string | null
  worldName: string | null
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
/** 신고 대상. 작품 신고는 `targetType`을 생략해도 된다(서버 기본값 `work`). */
export type ReportTarget =
  | { targetType?: 'work'; workId: string }
  | { targetType: 'episode'; workId: string; episodeNumber: number }
  | { targetType: 'world'; worldId: string }
export type ReportInput = { kind: ReportKind; reason: string; evidence: string } & ReportTarget

export const REPORT_KINDS: [ReportKind, string][] = [['RIGHTS', '권리 침해'], ['HARMFUL', '유해 콘텐츠']]
export const REPORT_STATUSES: [ReportStatus, string][] = [['RECEIVED', '접수'], ['ACCEPTED', '신고 인정'], ['REJECTED', '기각']]
const HISTORY_LABELS: Record<string, string> = {
  EVIDENCE: '증거 보완', EXPLANATION: '작가 소명', REVIEW: '검토 결과', RESTRICT: '콘텐츠 제한',
  UNRESTRICT: '제한 해제', EVIDENCE_REQUEST: '권리 증빙 요청',
}
export const reportKindLabel = (kind: ReportKind) => REPORT_KINDS.find(([k]) => k === kind)?.[1] ?? kind
export const reportStatusLabel = (status: ReportStatus) => REPORT_STATUSES.find(([s]) => s === status)?.[1] ?? status
export const REPORT_TARGET_TYPES: [ReportTargetType, string][] = [['work', '작품'], ['episode', '회차'], ['world', '세계관']]
export const reportTargetTypeLabel = (type: ReportTargetType) => REPORT_TARGET_TYPES.find(([t]) => t === type)?.[1] ?? type
/** 신고 대상의 이름: 작품은 제목, 회차는 `제목 N화`, 세계관은 이름이다. 이름을 모르면(지워진 대상) 종류만 쓴다. */
export function reportTargetTitle(r: Pick<Report, 'targetType' | 'workTitle' | 'episodeNumber' | 'worldName'>) {
  if (r.targetType === 'world') return r.worldName ?? '세계관'
  const work = r.workTitle ?? '작품'
  return r.targetType === 'episode' && r.episodeNumber ? `${work} ${r.episodeNumber}화` : work
}
export const historyLabel = (type: string) => HISTORY_LABELS[type] ?? type

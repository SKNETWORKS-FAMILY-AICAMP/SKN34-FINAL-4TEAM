import type { Report, ReportInput, ReportStatus, ReviewDecision } from '../entities/report'

/** 운영 공개 신고 API 계약. 변경 요청은 성공 여부만 돌려주며 화면은 상세를 다시 조회합니다. */
export interface ReportRepository {
  submit(input: ReportInput): Promise<void>
  listMine(): Promise<Report[]>
  listAll(status: ReportStatus | null): Promise<Report[]>
  get(id: string): Promise<Report>
  addEvidence(id: string, body: string): Promise<void>
  addExplanation(id: string, body: string): Promise<void>
  review(id: string, decision: ReviewDecision, note: string): Promise<void>
  setContentRestriction(id: string, restricted: boolean): Promise<void>
  requestEvidence(id: string, body: string): Promise<void>
}

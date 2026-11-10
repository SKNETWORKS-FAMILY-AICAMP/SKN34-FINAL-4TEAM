import {
  correctionInputError, reportInputError, responseInputError,
  type FeedbackReport, type FeedbackReportKind, type FeedbackReportVisibility, type SettableReportStatus,
} from '../entities/feedbackReport'
import type { FeedbackReportRepository } from '../repositories/FeedbackReportRepository'

/** 입력이 계약을 어기면 저장소를 부르기 전에 안내 문구로 던진다. */
function valid(error: string | null) {
  if (error) throw new Error(error)
}

/** 실제 작품(Content) 제보: 회차 등록·조회와 제보자(공개 범위·정정·철회)·작가(확인·답변·상태 변경)의 처리. */
export class FeedbackReportUseCase {
  private readonly repository: FeedbackReportRepository
  constructor(repository: FeedbackReportRepository) {
    this.repository = repository
  }

  /** quote는 선택 문장이다. 500자를 넘으면 잘라 보내지 않고 거절하며, 비어 있으면 보내지 않는다. */
  async register(workId: string, n: number, { kind, body, quote, visibility }: { kind: FeedbackReportKind; body: string; quote?: string | null; visibility: FeedbackReportVisibility }) {
    valid(reportInputError(body, quote))
    const text = quote?.trim()
    return this.repository.create(workId, n, text ? { kind, body: body.trim(), quote: text, visibility } : { kind, body: body.trim(), visibility })
  }

  listEpisode(workId: string, n: number) { return this.repository.listEpisode(workId, n) }
  listMine() { return this.repository.listMine() }
  listInbox() { return this.repository.listInbox() }

  setVisibility(r: FeedbackReport, visibility: FeedbackReportVisibility) { return this.repository.setVisibility(r.workId, r.id, visibility) }

  async correct(r: FeedbackReport, body: string) {
    valid(correctionInputError(body))
    return this.repository.correct(r.workId, r.id, body.trim())
  }

  withdraw(r: FeedbackReport) { return this.repository.withdraw(r.workId, r.id) }

  check(r: FeedbackReport) { return this.repository.check(r.workId, r.id) }

  async answer(r: FeedbackReport, body: string, isPublic: boolean) {
    valid(responseInputError(body))
    return this.repository.answer(r.workId, r.id, { body: body.trim(), isPublic })
  }

  /** 확인 전(unchecked)으로 되돌릴 수 없다는 계약은 인자 타입(SettableReportStatus)이 막는다. */
  setStatus(r: FeedbackReport, status: SettableReportStatus) { return this.repository.setStatus(r.workId, r.id, status) }
}

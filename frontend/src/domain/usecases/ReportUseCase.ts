import { OperationsError } from '../entities/operations'
import type { ReportInput, ReportKind, ReportStatus, ReviewDecision } from '../entities/report'
import type { ReportRepository } from '../repositories/ReportRepository'

/** 계약의 본문 규칙: 공백만·U+0000 금지, 최대 길이. 최종 검증은 서버가 합니다. */
function text(value: string, max: number, message: string, required = true) {
  const trimmed = value.trim()
  if ((required && !trimmed) || value.length > max || value.includes('\u0000')) throw new OperationsError(message)
  return trimmed
}
const body = (value: string) => text(value, Number.MAX_SAFE_INTEGER, '내용을 입력해 주세요.')
const KINDS: ReportKind[] = ['RIGHTS', 'HARMFUL']
const DECISIONS: ReviewDecision[] = ['ACCEPTED', 'REJECTED']

/** 신고 접수·내 신고·운영 검토(34). 실제 작품 제한은 운영 서비스가 Content에 요청합니다. */
export class ReportUseCase {
  private readonly repository: ReportRepository
  constructor(repository: ReportRepository) { this.repository = repository }

  async submit(input: ReportInput) {
    if (!KINDS.includes(input.kind)) throw new OperationsError('신고 종류를 선택해 주세요.')
    if (!input.workId.trim()) throw new OperationsError('신고할 작품을 확인할 수 없어요.')
    const reason = text(input.reason, 2000, '신고 사유는 1~2000자로 입력해 주세요.')
    const evidence = text(input.evidence, 5000, '증거는 5000자 이하로 입력해 주세요.', false)
    return this.repository.submit({ kind: input.kind, workId: input.workId, reason, evidence })
  }
  listMine() { return this.repository.listMine() }
  listAll(status: ReportStatus | null) { return this.repository.listAll(status) }
  get(id: string) { return this.repository.get(id) }
  async addEvidence(id: string, value: string) { return this.repository.addEvidence(id, body(value)) }
  async addExplanation(id: string, value: string) { return this.repository.addExplanation(id, body(value)) }
  async requestEvidence(id: string, value: string) { return this.repository.requestEvidence(id, body(value)) }
  async review(id: string, decision: ReviewDecision, note: string) {
    if (!DECISIONS.includes(decision)) throw new OperationsError('검토 결과를 선택해 주세요.')
    return this.repository.review(id, decision, text(note, 2000, '검토 메모는 1~2000자로 입력해 주세요.'))
  }
  setContentRestriction(id: string, restricted: boolean) { return this.repository.setContentRestriction(id, restricted) }
}

import { OperationsError } from '../entities/operations'
import type { SupportInquiryInput, SupportInquiryStatus } from '../entities/supportInquiry'
import type { SupportInquiryRepository } from '../repositories/SupportInquiryRepository'

/** 계약의 입력 규칙: 공백만·U+0000 금지, 최대 길이. 최종 검증과 권한 판단은 서버가 합니다. */
const invalid = (value: string, max: number) => !value.trim() || value.length > max || value.includes('\u0000')

/** 회원 문의 접수·내 문의(U34)와 관리자 문의 대응·답변(67). 실패는 성공으로 바꾸지 않고 그대로 전달합니다. */
export class SupportInquiryUseCase {
  private readonly repository: SupportInquiryRepository
  constructor(repository: SupportInquiryRepository) { this.repository = repository }

  listMine() { return this.repository.listMine() }
  /** category·title은 앞뒤 공백을 지워 보내고, 본문은 입력 그대로 보냅니다. */
  async create(input: SupportInquiryInput) {
    const category = input.category.trim(), title = input.title.trim()
    if (!title || !input.body.trim()) throw new OperationsError('제목과 내용을 입력해 주세요')
    if (invalid(category, 50)) throw new OperationsError('문의 유형은 1~50자로 선택해 주세요.')
    if (invalid(title, 200)) throw new OperationsError('제목은 1~200자로 입력해 주세요.')
    if (invalid(input.body, 20000)) throw new OperationsError('내용은 1~20000자로 입력해 주세요.')
    return this.repository.create({ category, title, body: input.body })
  }

  listAll(status: SupportInquiryStatus | null) { return this.repository.listAll(status) }
  get(id: string) { return this.repository.get(id) }
  async addReply(id: string, body: string) { return this.repository.addReply(id, reply(body)) }
  async updateReply(id: string, replyId: string, body: string) { return this.repository.updateReply(id, replyId, reply(body)) }
  deleteReply(id: string, replyId: string) { return this.repository.deleteReply(id, replyId) }
}

function reply(body: string) {
  if (invalid(body, 20000)) throw new OperationsError('답변은 1~20000자로 입력해 주세요.')
  return body
}

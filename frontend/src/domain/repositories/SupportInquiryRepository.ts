import type { SupportInquiry, SupportInquiryInput, SupportInquiryStatus } from '../entities/supportInquiry'

/** 운영 공개 고객지원 문의 API 계약(회원 Bearer). 변경 요청은 성공 여부만 돌려주며 화면은 다시 조회합니다. */
export interface SupportInquiryRepository {
  listMine(): Promise<SupportInquiry[]>
  create(input: SupportInquiryInput): Promise<void>
  /** 관리자 `feedback` 권한. 상태를 주지 않으면 전체입니다. */
  listAll(status: SupportInquiryStatus | null): Promise<SupportInquiry[]>
  get(id: string): Promise<SupportInquiry>
  addReply(id: string, body: string): Promise<void>
  updateReply(id: string, replyId: string, body: string): Promise<void>
  deleteReply(id: string, replyId: string): Promise<void>
}

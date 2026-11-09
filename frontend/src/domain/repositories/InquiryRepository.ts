import type { Inquiry } from '../entities/account'

export interface InquiryRepository {
  list(): Promise<Inquiry[]>
  /** 맨 앞에 추가합니다. */
  add(inquiry: Inquiry): Promise<void>
}

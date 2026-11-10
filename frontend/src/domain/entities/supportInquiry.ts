/** 운영 고객지원 문의(67). 정본은 운영 서비스이며 status는 답변 유무로 계산한 값입니다. */
export type SupportInquiryStatus = 'WAITING' | 'ANSWERED'
export type SupportReply = { id: string; body: string; createdAt: string; updatedAt: string }
export type SupportInquiry = {
  id: string
  memberId: string
  category: string
  title: string
  body: string
  status: SupportInquiryStatus
  createdAt: string
  updatedAt: string
  /** 등록 오래된 순입니다. */
  replies: SupportReply[]
}
export type SupportInquiryInput = { category: string; title: string; body: string }

export const SUPPORT_STATUSES: [SupportInquiryStatus, string][] = [['WAITING', '답변 대기'], ['ANSWERED', '답변 완료']]
export const supportStatusLabel = (status: SupportInquiryStatus) => SUPPORT_STATUSES.find(([s]) => s === status)?.[1] ?? status

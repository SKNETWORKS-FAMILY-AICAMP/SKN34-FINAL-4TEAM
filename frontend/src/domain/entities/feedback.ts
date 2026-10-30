/** 목업 S.comments의 댓글: [닉네임, 내용, 좋아요, 문장 인용·스포일러] */
export type CommentMeta = { q: string; spoiler: boolean }
export type Comment = [nick: string, text: string, likes: number, meta?: CommentMeta]

/** 회차 본문에서 고른 문장과 그 문단 번호 */
export type Sentence = { t: string; pi: number }

/** 목업 S.reports: 독자가 보낸 피드백·신고 기록 */
export type ReaderReport = { id: string; w: string; n: number | null; type: string; text: string; status: string; reply: string }

/** 목업 S.inbox: 작가 피드백함 항목 */
export type InboxItem = {
  id: string; rid: string; w: string; n: number; pi: number; type: string; who: string; text: string; baseText: string; status: string
  ai: { cls: string; why: string; ev: string }; from?: string; to?: string; answer?: string
}

/** 목업 S.admin.queue: 운영팀 신고 검토 목록 */
export type ReviewItem = { id: string; w: string; n: null; type: string; text: string; quote: string; status: string; who: string; appeal?: string; beforeHidden?: boolean }

export const FEEDBACK_TYPES = ['단순 오류', '스토리 오류', '질문', '제안'] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

export const REPORT_TYPES: [string, string][] = [['권리 침해', '저작권·인격권 등 권리 문제'], ['유해 콘텐츠', '안전한 이용을 해치는 콘텐츠']]

/** 목업 TYPO: 데모가 알아보는 표기 오류 */
export const TYPO: Record<string, string> = { '않 된다': '안 된다', '되뇌였다': '되뇌었다' }

/** 목업 reader() body: 문단을 문장으로 나눕니다. */
export const splitSentences = (paras: string[]): Sentence[][] =>
  paras.map((par, pi) => (par.match(/[^.!?”]+[.!?…]*”?|[^.!?]+$/g) ?? [par]).map((t) => ({ t: t.trim(), pi })).filter((s) => s.t))

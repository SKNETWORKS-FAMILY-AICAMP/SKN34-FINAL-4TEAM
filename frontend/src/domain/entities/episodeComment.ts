/** Content 회차 댓글(계약 CommentResponse). 목업 데모의 Comment 튜플(feedback.ts)과 별개다. */
export type EpisodeComment = {
  id: string
  workId: string
  episodeNumber: number
  /** 작성 시점의 발행 버전. 이후 발행본이 바뀌어도 그대로다. */
  publishedVersionId: string
  authorName: string
  body: string
  /** 작성 시 고른 문장. 수정할 수 없다. */
  quote: string | null
  spoiler: boolean
  likeCount: number
  liked: boolean
  mine: boolean
  edited: boolean
  /** 운영 정책으로 숨긴 댓글. 서버가 body를 비워 보내므로 화면은 자리표시만 보이고 수정·좋아요를 막는다(작성자 삭제는 가능). */
  hidden: boolean
  createdAt: string
  updatedAt: string
}

export const COMMENT_SORTS = [['latest', '최신순'], ['likes', '좋아요순']] as const
export type CommentSort = (typeof COMMENT_SORTS)[number][0]

/** 본문(공백 제거 후)·인용 문장의 최대 글자 수 */
export const COMMENT_MAX = 500

/** 작성·수정 입력의 안내 문구(통과하면 null). 본문은 앞뒤 공백을 지운 뒤 1~500자, 인용 문장은 500자 이하다(계약). */
export function commentInputError(body: string, quote?: string | null) {
  const text = body.trim()
  if (!text) return '댓글 내용을 입력해 주세요.'
  if (text.length > COMMENT_MAX) return `댓글은 ${COMMENT_MAX}자까지 남길 수 있어요.`
  if (quote && quote.length > COMMENT_MAX) return `인용한 문장이 ${COMMENT_MAX}자를 넘어 댓글에 붙일 수 없어요.`
  return null
}

import { commentInputError, type CommentSort, type EpisodeComment } from '../entities/episodeComment'
import type { EpisodeCommentRepository } from '../repositories/EpisodeCommentRepository'

/** 입력이 계약을 어기면 저장소를 부르기 전에 안내 문구로 던진다. */
function check(body: string, quote?: string | null) {
  const error = commentInputError(body, quote)
  if (error) throw new Error(error)
  return body.trim()
}

/** 실제 작품(Content) 회차 댓글: 목록·작성·수정·삭제·좋아요. */
export class EpisodeCommentUseCase {
  private readonly repository: EpisodeCommentRepository
  constructor(repository: EpisodeCommentRepository) {
    this.repository = repository
  }

  list(workId: string, n: number, sort: CommentSort) {
    return this.repository.list(workId, n, sort)
  }

  /** quote는 선택 문장(수정 불가)이다. 500자를 넘으면 잘라 보내지 않고 거절한다. */
  async create(workId: string, n: number, { body, quote, spoiler }: { body: string; quote?: string | null; spoiler: boolean }) {
    const text = check(body, quote)
    return this.repository.create(workId, n, quote ? { body: text, quote, spoiler } : { body: text, spoiler })
  }

  async update(c: EpisodeComment, body: string, spoiler: boolean) {
    return this.repository.update(c.workId, c.episodeNumber, c.id, { body: check(body), spoiler })
  }

  remove(c: EpisodeComment) {
    return this.repository.remove(c.workId, c.episodeNumber, c.id)
  }

  /** 지금 좋아요면 취소, 아니면 등록한다. */
  toggleLike(c: EpisodeComment) {
    return c.liked ? this.repository.unlike(c.workId, c.episodeNumber, c.id) : this.repository.like(c.workId, c.episodeNumber, c.id)
  }
}

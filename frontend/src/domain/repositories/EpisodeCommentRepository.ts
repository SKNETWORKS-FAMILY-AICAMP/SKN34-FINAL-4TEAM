import type { CommentSort, EpisodeComment } from '../entities/episodeComment'

/** 회차 댓글 저장소 계약([기능 22](../../../../docs/design/episode-comment-contract.md)). 모든 호출은 Content 공개 API다. */
export interface EpisodeCommentRepository {
  list(workId: string, episode: number, sort: CommentSort): Promise<EpisodeComment[]>
  /** 공개 작품의 현재 발행 회차 전체 댓글(읽기 전용, 최대 200개). 각 댓글의 episodeNumber로 회차를 알 수 있다. */
  listByWork(workId: string, sort: CommentSort): Promise<EpisodeComment[]>
  create(workId: string, episode: number, input: { body: string; quote?: string; spoiler?: boolean }): Promise<EpisodeComment>
  update(workId: string, episode: number, commentId: string, input: { body: string; spoiler: boolean }): Promise<EpisodeComment>
  remove(workId: string, episode: number, commentId: string): Promise<void>
  /** 이미 좋아요여도 성공한다(멱등). */
  like(workId: string, episode: number, commentId: string): Promise<void>
  /** 좋아요가 없어도 성공한다(멱등). */
  unlike(workId: string, episode: number, commentId: string): Promise<void>
}

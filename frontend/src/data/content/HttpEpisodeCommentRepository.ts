import { z } from 'zod'

import type { CommentSort, EpisodeComment } from '../../domain/entities/episodeComment'
import type { EpisodeCommentRepository } from '../../domain/repositories/EpisodeCommentRepository'
import { getAccessToken } from '../api/auth'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'

const comment: z.ZodType<EpisodeComment> = z.object({
  id: z.string(), workId: z.string(), episodeNumber: z.number().int().positive(), publishedVersionId: z.string(),
  authorName: z.string(), body: z.string(), quote: z.string().nullable(), spoiler: z.boolean(),
  likeCount: z.number().int().nonnegative(), liked: z.boolean(), mine: z.boolean(), edited: z.boolean(),
  // 운영 숨김(75) 이전 응답에는 hidden이 없다.
  hidden: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
})
const comments = z.object({ items: z.array(comment) })

const all = (id: string, n: number) => `/works/${encodeURIComponent(id)}/episodes/${n}/comments`
const one = (id: string, n: number, commentId: string) => `${all(id, n)}/${encodeURIComponent(commentId)}`

/** 회차 댓글 API(기능 22). Bearer·CSRF·오류 문구·응답 검증은 HttpEpisodeRepository.request를 그대로 쓴다. */
export class HttpEpisodeCommentRepository implements EpisodeCommentRepository {
  private readonly api: HttpEpisodeRepository
  constructor(fetcher?: typeof fetch) { this.api = new HttpEpisodeRepository(fetcher) }

  /** 공개 읽기: 로그인 상태면 Bearer를 함께 보내 mine·liked를 받고, 익명이면 그냥 읽는다. */
  async list(id: string, n: number, sort: CommentSort) {
    return (await this.api.request(`/public${all(id, n)}?sort=${sort}`, comments, 'GET', undefined, undefined, !getAccessToken())).items
  }
  create(id: string, n: number, input: { body: string; quote?: string; spoiler?: boolean }) { return this.api.request(all(id, n), comment, 'POST', input) }
  update(id: string, n: number, commentId: string, input: { body: string; spoiler: boolean }) { return this.api.request(one(id, n, commentId), comment, 'PUT', input) }
  remove(id: string, n: number, commentId: string) { return this.api.request(one(id, n, commentId), z.undefined(), 'DELETE') }
  like(id: string, n: number, commentId: string) { return this.api.request(one(id, n, commentId) + '/like', z.undefined(), 'PUT') }
  unlike(id: string, n: number, commentId: string) { return this.api.request(one(id, n, commentId) + '/like', z.undefined(), 'DELETE') }
}

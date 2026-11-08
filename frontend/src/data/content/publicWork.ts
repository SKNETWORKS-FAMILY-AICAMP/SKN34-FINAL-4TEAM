import { z } from 'zod'
import type { Work } from '../../domain/entities/work'

/** Content 공개 작품 응답(WorkResponse)에서 카드 화면이 쓰는 값만 검증한다. views는 최근 24시간 조회 수다. */
export const publicWork = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  views: z.number().int().nonnegative(),
  genres: z.array(z.string()).optional(),
  source: z.object({ workId: z.string(), episode: z.number().int(), direction: z.string() }).nullable(),
  episodes: z.array(z.object({ title: z.string() })),
})

/**
 * 기존 카드 화면의 Work로 바꾼다. 서버에 없는 표시 값(작가·표지 테마·좋아요·갱신 시각)은 중립 기본값이다.
 * 원작/Fork는 source 유무로 가른다.
 */
export function toCardWork(w: z.infer<typeof publicWork>): Work {
  const { source } = w
  return {
    id: w.id, title: w.title, summary: w.summary, theme: 'hanji', genre: (w.genres ?? []).join(' · '),
    author: '', kind: source ? '포크' : '원작', rights: '', by: '', tags: source ? ['if'] : [],
    likes: 0, views: w.views, cmts: 0, upd: 0,
    cast: [], rules: [], events: [], eps: w.episodes.map((e) => ({ t: e.title, p: [] })),
    ...(source && { parent: source.workId, forkAt: source.episode, dir: source.direction }),
  }
}

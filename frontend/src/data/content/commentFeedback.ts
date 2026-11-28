import { z } from 'zod'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'

const api = new HttpEpisodeRepository()
const inbox = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(z.object({ id: z.string(), episodeNumber: z.number().int().positive(), body: z.string() })),
})

export function commentFeedback(work: string, episode: number | null, offset: number, size: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ offset: String(offset), size: String(size) })
  if (episode !== null) query.set('episode', String(episode))
  return api.request(`/works/${encodeURIComponent(work)}/comment-feedback?${query}`, inbox, 'GET', undefined, signal)
}

export async function commentFeedbackCount(work: string, signal?: AbortSignal) {
  return (await commentFeedback(work, null, 0, 0, signal)).total
}

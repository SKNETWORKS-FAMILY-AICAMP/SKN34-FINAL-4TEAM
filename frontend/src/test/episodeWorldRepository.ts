import { InMemoryWorldStudioRepository } from '../data/world-studio/InMemoryWorldStudioRepository'
import type { StudioSetting } from '../domain/entities/studioWorld'

/**
 * 관계를 회차 시점으로 읽고 쓰는 서버 저장소 대역(DEC-51). 메모리 저장소에 `relationEpisodes`를 달고, 회차를 주면 `relations[회차]`를 그 시점 관계로 바꿔 읽는다.
 * 회차를 생략하거나 정해 두지 않은 회차는 저장된 최신 관계 그대로다.
 */
export class EpisodeWorldRepository extends InMemoryWorldStudioRepository {
  readonly relationEpisodes = true as const
  relations: Record<number, StudioSetting[]> = {}
  override async read(id: string, _signal?: AbortSignal, episode?: number) {
    const world = await super.read(id), at = episode === undefined ? undefined : this.relations[episode]
    return at ? { ...world, settings: [...world.settings.filter((s) => s.item.kind !== 'relation'), ...at] } : world
  }
}

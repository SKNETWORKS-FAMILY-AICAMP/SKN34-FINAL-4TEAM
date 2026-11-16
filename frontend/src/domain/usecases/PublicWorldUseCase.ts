import type { PublicWorld, PublicWorldGenre, PublicWorldPage } from '../entities/publicWorld'
import type { PublicWorldRepository } from '../repositories/PublicWorldRepository'

export const PUBLIC_WORLD_PAGE_SIZE = 24
/** 목록 화면(지도·순위·모아 보기)이 한 번에 읽는 쪽 수의 상한. 그보다 많은 세계관은 최근 공개 순으로 앞쪽만 보인다.
 * ponytail: 24×4=96개까지만 읽는다(서버는 쪽마다 Neo4j를 읽어 한 번에 많이 받지 않는다). 공개 세계관이 그보다 늘면 모아 보기에 '더 보기'(다음 쪽)를 둔다. */
export const PUBLIC_WORLD_MAX_PAGES = 4

/** 공개 세계관 둘러보기: 목록(여러 쪽을 이어 붙임)과 상세. 실제 모드는 Content API, `--mode mockup`은 메모리 저장소가 같은 계약을 따른다. */
export class PublicWorldUseCase {
  private readonly repository: PublicWorldRepository
  constructor(repository: PublicWorldRepository) {
    this.repository = repository
  }

  /**
   * 최근 공개 순으로 첫 `PUBLIC_WORLD_MAX_PAGES`쪽까지 이어 붙인다. 다음 쪽은 서버가 실제로 쓴 쪽 크기로 요청하고, 쪽을 읽는 사이 목록이 밀려 겹친 세계관은 처음 것만 남긴다.
   * 한 쪽이라도 실패하면 일부 결과로 숨기지 않고 던진다. `total`은 서버가 센 전체 수라 `items`보다 클 수 있다.
   */
  async list(query: { genre?: PublicWorldGenre } = {}, signal?: AbortSignal): Promise<PublicWorldPage> {
    const first = await this.repository.list({ ...query, page: 0, size: PUBLIC_WORLD_PAGE_SIZE }, signal)
    const items = new Map(first.items.map((w) => [w.id, w]))
    let last = first
    for (let page = 1; page < PUBLIC_WORLD_MAX_PAGES && items.size < first.total && last.items.length > 0; page++) {
      last = await this.repository.list({ ...query, page, size: first.size }, signal)
      for (const w of last.items) if (!items.has(w.id)) items.set(w.id, w)
    }
    return { ...first, items: [...items.values()] }
  }

  /** 비공개·없는 세계관은 undefined다(화면은 "찾을 수 없는 세계관"). 실패는 던진다. */
  get(id: string, signal?: AbortSignal): Promise<PublicWorld | undefined> {
    return this.repository.get(id, signal)
  }
}

import { genreNameOf, type Genre } from '../entities/genre'
import type { PublicWorld, PublicWorldCardPage, PublicWorldLineage, PublicWorldPage } from '../entities/publicWorld'
import type { GenreRepository } from '../repositories/GenreRepository'
import type { PublicWorldRepository } from '../repositories/PublicWorldRepository'

export const PUBLIC_WORLD_PAGE_SIZE = 24
/** 목록 화면(지도·순위·모아 보기)이 한 번에 읽는 쪽 수의 상한. 그보다 많은 세계관은 최근 공개 순으로 앞쪽만 보인다.
 * ponytail: 24×4=96개까지만 읽는다(서버는 쪽마다 Neo4j를 읽어 한 번에 많이 받지 않는다). 공개 세계관이 그보다 늘면 모아 보기에 '더 보기'(다음 쪽)를 둔다. */
export const PUBLIC_WORLD_MAX_PAGES = 4

/** 세계관의 장르 코드에 공개 장르 목록(활성 장르)의 이름을 붙인다. 목록에 없는 코드(숨긴 장르)와 장르 없음은 이름이 없다(null). */
const named = <T extends { genre: string | null }>(world: T, genres: readonly Genre[]) => ({ ...world, genreName: genreNameOf(genres, world.genre) })

/** 데모 계보 줄(원본·조합 원본·파생·조합된 세계관)의 세계관에도 같은 규칙으로 장르 이름을 붙인다. */
const namedLineage = (lineage: PublicWorldLineage, genres: readonly Genre[]): PublicWorldLineage => ({
  ...(lineage.derivedFrom ? { derivedFrom: named(lineage.derivedFrom, genres) } : {}),
  combinedFrom: lineage.combinedFrom.map((w) => named(w, genres)),
  children: lineage.children.map((w) => named(w, genres)),
})

/**
 * 공개 세계관 둘러보기: 목록(여러 쪽을 이어 붙임)과 상세. 실제 모드는 Content API, `--mode mockup`은 메모리 저장소가 같은 계약을 따른다.
 * 서버는 장르 코드만 주므로 세계관 요청마다 공개 장르 목록을 함께 읽어 이름(`genreName`)을 붙인다. 장르 목록을 읽지 못하면 이름 없는 결과로 숨기지 않고 던진다.
 */
export class PublicWorldUseCase {
  private readonly repository: PublicWorldRepository
  private readonly genres: GenreRepository
  constructor(repository: PublicWorldRepository, genres: GenreRepository) {
    this.repository = repository
    this.genres = genres
  }

  /**
   * 최근 공개 순으로 첫 `PUBLIC_WORLD_MAX_PAGES`쪽까지 이어 붙인다. 다음 쪽은 서버가 실제로 쓴 쪽 크기로 요청하고, 쪽을 읽는 사이 목록이 밀려 겹친 세계관은 처음 것만 남긴다.
   * 한 쪽이라도 실패하면 일부 결과로 숨기지 않고 던진다. `total`은 서버가 센 전체 수라 `items`보다 클 수 있다.
   */
  async list(query: { genre?: string } = {}, signal?: AbortSignal): Promise<PublicWorldPage> {
    const [genres, first] = await Promise.all([this.genres.list(signal), this.repository.list({ ...query, page: 0, size: PUBLIC_WORLD_PAGE_SIZE }, signal)])
    const items = new Map(first.items.map((w) => [w.id, w]))
    let last = first
    for (let page = 1; page < PUBLIC_WORLD_MAX_PAGES && items.size < first.total && last.items.length > 0; page++) {
      last = await this.repository.list({ ...query, page, size: first.size }, signal)
      for (const w of last.items) if (!items.has(w.id)) items.set(w.id, w)
    }
    return { ...first, items: [...items.values()].map((w) => named(w, genres)) }
  }

  /**
   * `/search` 세계관 탭·전체 탭 묶음·빠른 이동: 검색어에 맞는 세계관 한 쪽(`size` 기본 24, 전체 탭은 6·빠른 이동은 3). 번호 쪽은 `page`(0부터)로 읽는다(`list`처럼 여러 쪽을 이어 붙이지 않는다).
   * 검색어가 비면 전체 목록이다.
   */
  async searchWorlds({ q, page, size = PUBLIC_WORLD_PAGE_SIZE }: { q: string; page: number; size?: number }, signal?: AbortSignal): Promise<PublicWorldPage> {
    const [genres, found] = await Promise.all([this.genres.list(signal), this.repository.list({ q, page, size }, signal)])
    return { ...found, items: found.items.map((w) => named(w, genres)) }
  }

  /** `/search` 설정 카드 탭·전체 탭 묶음·빠른 이동: 검색어에 맞는 카드 한 쪽(검색어는 비면 안 된다, `size` 기본 24). */
  searchCards({ q, page, size = PUBLIC_WORLD_PAGE_SIZE }: { q: string; page: number; size?: number }, signal?: AbortSignal): Promise<PublicWorldCardPage> {
    return this.repository.searchCards({ q, page, size }, signal)
  }

  /** 비공개·없는 세계관은 undefined다(화면은 "찾을 수 없는 세계관"). 실패는 던진다. */
  async get(id: string, signal?: AbortSignal): Promise<PublicWorld | undefined> {
    const [genres, world] = await Promise.all([this.genres.list(signal), this.repository.get(id, signal)])
    return world && { ...named(world, genres), ...(world.lineage ? { lineage: namedLineage(world.lineage, genres) } : {}) }
  }
}

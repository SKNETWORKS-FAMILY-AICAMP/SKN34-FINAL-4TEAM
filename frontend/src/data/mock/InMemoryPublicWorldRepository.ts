import { lineageOrigins, type PublicWorld, type PublicWorldLineage, type PublicWorldPage, type PublicWorldRef, type PublicWorldSummary } from '../../domain/entities/publicWorld'
import type { PublicWorldQuery, PublicWorldRepository } from '../../domain/repositories/PublicWorldRepository'
import { DEMO_WORLDS, type DemoWorld } from './demoPublicWorlds'

// 데모는 배열 뒤쪽일수록 최근에 공개됐다고 본다(하루 간격). 목록은 서버처럼 최근 공개 순이라 역순이다.
const FIRST_PUBLISHED = Date.UTC(2026, 9, 1)
const DAY = 24 * 60 * 60 * 1000

const publishedAt = (index: number) => new Date(FIRST_PUBLISHED + index * DAY).toISOString()
const ref = (w: DemoWorld): PublicWorldRef => ({ id: w.id, name: w.name, genre: w.genre, authorNickname: w.author, cardCount: w.cards.length })

/** 카드 연관(제목으로 이은 `links`)을 서버의 현재 관계 목록으로 바꾼다. 카드 id는 카드 위치다. */
const relationshipsOf = (w: DemoWorld) => {
  const at = new Map(w.cards.map((c, i) => [c.title, String(i)]))
  return w.cards
    .flatMap((c, a) => (c.links ?? []).flatMap(({ to, label }) => (at.has(to) ? [{ sourceCardId: String(a), targetCardId: at.get(to)!, label: label ?? '' }] : [])))
    .map((r, n) => ({ id: `${w.id}-r${n}`, ...r }))
}

/** 서버 공개 세계관 API 대신 메모리 데모 세계관을 같은 계약으로 돌려준다(`--mode mockup`·테스트). 쓰기가 없어 새로고침하면 처음과 같다. */
export class InMemoryPublicWorldRepository implements PublicWorldRepository {
  private readonly worlds: readonly DemoWorld[]
  constructor(worlds: readonly DemoWorld[] = DEMO_WORLDS) {
    this.worlds = worlds
  }

  private summary(w: DemoWorld, index: number): PublicWorldSummary {
    return {
      id: w.id, name: w.name, description: w.description, genre: w.genre, authorNickname: w.author, cardCount: w.cards.length, relationshipCount: relationshipsOf(w).length,
      publishedAt: publishedAt(index), cards: w.cards.map((c, i) => ({ id: String(i), title: c.title, cardType: c.type })),
      ...(w.derivedFrom ? { derivedFrom: w.derivedFrom } : {}), ...(w.combinedFrom ? { combinedFrom: w.combinedFrom } : {}),
    }
  }

  private lineage(world: DemoWorld): PublicWorldLineage {
    const byId = new Map(this.worlds.map((w) => [w.id, w]))
    const known = new Set(byId.keys())
    const origins = lineageOrigins(world, known)
    const derived = origins.find((o) => o.kind === 'derive')
    return {
      ...(derived ? { derivedFrom: ref(byId.get(derived.id)!) } : {}),
      combinedFrom: origins.filter((o) => o.kind === 'combine').map((o) => ref(byId.get(o.id)!)),
      children: this.worlds.filter((w) => w.id !== world.id && lineageOrigins(w, known).some((o) => o.id === world.id)).map((w) => ({ ...ref(w), kind: w.derivedFrom === world.id ? 'derive' : 'combine' })),
    }
  }

  async list({ genre, page, size }: PublicWorldQuery): Promise<PublicWorldPage> {
    const matched = this.worlds.map((w, i) => this.summary(w, i)).filter((w) => !genre || w.genre === genre).toReversed()
    return { items: matched.slice(page * size, (page + 1) * size), page, size, total: matched.length, demo: true }
  }

  async get(id: string): Promise<PublicWorld | undefined> {
    const index = this.worlds.findIndex((w) => w.id === id)
    if (index < 0) return undefined
    const w = this.worlds[index]
    return {
      id: w.id, name: w.name, description: w.description, genre: w.genre, authorNickname: w.author, publishedAt: publishedAt(index), revisionNo: 1,
      cards: w.cards.map((c, i) => ({ id: String(i), title: c.title, text: c.text, cardType: c.type, aliases: [], tags: [] })),
      relationships: relationshipsOf(w), relationshipStatus: 'current',
      demo: true, hook: w.hook, lineage: this.lineage(w), works: w.works ?? [],
    }
  }
}

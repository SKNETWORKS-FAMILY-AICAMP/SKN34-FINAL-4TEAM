import type { Draft } from '../../domain/entities/draft'
import type { StoryEvent, Work } from '../../domain/entities/work'
import { AGGREGATE_WRITE_UNSUPPORTED, type WorkRepository } from '../../domain/repositories/WorkRepository'
import { WCATS } from '../../domain/entities/wiki'
import { getAccessToken, authVersion, assertAuthVersion } from '../api/auth'
import { HttpEpisodeRepository, type ReadingWorkRecord, type ReadingWorldRecord } from './HttpEpisodeRepository'

export function mapReadingWork(row: ReadingWorkRecord, mine = false): Work {
  const episodes = [...row.episodes].sort((a, b) => a.number - b.number)
  const mapEpisode = (e: typeof episodes[number]) => ({ t: e.title, p: e.body.split('\n\n'), versionId: e.versionId })
  const inherited = episodes.filter(e => e.inherited).map(mapEpisode)
  return {
    id: row.id, slug: row.slug ?? undefined, canonical: true, title: row.title, summary: row.summary, theme: row.theme,
    author: row.authorName, owner: row.ownerId, mine, genre: (row.genres ?? []).join(' · '),
    kind: row.source ? '포크' : '원작', rights: '권리 진술 별도 확인', by: row.authorName,
    tags: row.source ? ['if'] : [], hash: (row.hashtags ?? []).map(t => '#' + t),
    statisticsSupported: false, likes: 0, views: 0, cmts: 0, upd: 0,
    hook: row.hook, hanja: row.hanja ?? undefined, hero: row.hero ?? undefined, heroBg: row.heroBg ?? undefined,
    private: row.visibility !== 'public', forksAllowed: row.allowFork, forkAll: false, forkEps: row.forkableEpisodes,
    forkFrom: row.forkableEpisodes[0] ?? 0, parent: row.source?.workId, forkAt: row.source?.episode, dir: row.source?.direction,
    eps: episodes.filter(e => !e.inherited).map(mapEpisode), cast: [], rules: [], events: [],
    wiki: { docs: [], cats: structuredClone(WCATS) },
    ...(row.source ? { snap: { eps: inherited, rules: [], cast: [], events: [], takenAt: 0, srcHash: '' } } : {}),
  }
}

export function withReadingWorld(work: Work, world: ReadingWorldRecord): Work {
  if (world.workId !== work.id) throw new Error('세계관 응답의 작품을 확인할 수 없어요.')
  const docs = world.documents.map(d => ({ id: d.id, cat: d.category, t: d.name, body: d.body,
    alias: d.aliases, tags: d.tags, props: Object.fromEntries(d.properties.map(p => [p.name, p.value])),
    at: {}, img: d.image, knowledge: d.knowledge, ep: d.episode ?? undefined, line: d.line ?? undefined,
    who: d.participants, links: d.links.map(l => ({ to: l.to, k: l.kind })),
  }))
  const cast = world.documents.filter(d => d.category === 'char').map(d => ({ n: d.name, c: d.color,
    d: d.properties.find(p => p.name === '설명')?.value ?? d.body, st: d.properties.find(p => p.name === '상태')?.value ?? '—', knowledge: d.knowledge }))
  const rules = world.documents.filter(d => d.category === 'world').map(d => d.name)
  const events: StoryEvent[] = world.documents.filter(d => d.category === 'event' && d.episode != null)
    .map(d => [d.episode!, d.line ?? 'm', d.name, d.participants])
  return { ...work, cast, rules, events, wiki: { docs, cats: structuredClone(WCATS) },
    ...(work.snap ? { snap: { ...work.snap, cast, rules, events } } : {}),
  }
}

/** Canonical reads and Fork writes only; rich demo mutations never pretend to persist. */
export class HttpWorkRepository implements WorkRepository {
  private readonly api: HttpEpisodeRepository
  private readonly authenticated: () => boolean
  constructor(api = new HttpEpisodeRepository(), authenticated = () => !!getAccessToken()) {
    this.api = api
    this.authenticated = authenticated
  }
  async listWorks(): Promise<Work[]> {
    const version = authVersion()
    const [publicRows, owned] = await Promise.all([this.api.readingList(false), this.authenticated() ? this.api.readingList(true) : Promise.resolve([])])
    assertAuthVersion(version)
    const records = new Map(publicRows.map(row => [row.id, mapReadingWork(row)]))
    for (const row of owned) records.set(row.id, mapReadingWork(row, true))
    return [...records.values()]
  }
  async listWorlds() { return [] }
  async readWorld(work: Work, episode: number) {
    if (work.private || episode < 1) return work
    const world = await this.api.readingWorld(work.id, episode)
    if (world.episode !== episode) throw new Error('세계관 응답의 기준 회차를 확인할 수 없어요.')
    return withReadingWorld(work, world)
  }
  async createFork(id: string, episode: number, title: string, direction: string) {
    const made = await this.api.fork(id, episode, title, direction)
    return { id: made.id }
  }
  async getDraft(key: string): Promise<Draft | undefined> {
    const [id, selected] = key.split(':ep:')
    const rows = await this.api.writingList(id)
    const row = selected ? rows.find(e => e.number === +selected) : [...rows].reverse().find(e => !e.inherited && e.hasDraft !== false)
    if (!row || row.hasDraft === false) return undefined
    return { no: row.number, title: row.draft.title, paras: row.draft.body ? row.draft.body.split('\n\n') : [], authorNote: '',
      links: [], sim: null, proposal: null, check: null, saved: true }
  }
  async listDrafts(): Promise<Record<string, Draft>> {
    const works = (await this.listWorks()).filter(w => w.mine)
    const entries = await Promise.all(works.map(async w => [w.id, await this.getDraft(w.id)] as const))
    return Object.fromEntries(entries.filter((e): e is readonly [string, Draft] => e[1] !== undefined))
  }
  async saveWork(_work: Work): Promise<void> { throw new Error(AGGREGATE_WRITE_UNSUPPORTED) }
  async saveDraft(_key: string, _draft: Draft): Promise<void> { throw new Error(AGGREGATE_WRITE_UNSUPPORTED) }
  async deleteDraft(_key: string): Promise<void> { throw new Error(AGGREGATE_WRITE_UNSUPPORTED) }
}

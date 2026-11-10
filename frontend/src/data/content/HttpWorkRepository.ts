import type { Draft } from '../../domain/entities/draft'
import { epsOf, type Work } from '../../domain/entities/work'
import { AGGREGATE_WRITE_UNSUPPORTED, type WorkRepository } from '../../domain/repositories/WorkRepository'
import { getAccessToken, authVersion, assertAuthVersion } from '../api/auth'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'
import { mapReadingWork, withReadingWorld } from './readingWork'

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
    if (work.private || episode < 1 || epsOf(work)[episode-1]?.hidden) return work
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

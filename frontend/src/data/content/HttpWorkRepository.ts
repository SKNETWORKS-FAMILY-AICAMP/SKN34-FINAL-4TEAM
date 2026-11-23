import type { Draft } from '../../domain/entities/draft'
import { epsOf, type Work } from '../../domain/entities/work'
import { AGGREGATE_WRITE_UNSUPPORTED, type WorkRepository } from '../../domain/repositories/WorkRepository'
import { getAccessToken, authVersion, assertAuthVersion } from '../api/auth'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'
import { mapReadingWork, withReadingWorld } from './readingWork'

/**
 * 서버(ForkService)는 삭제한 포크까지 세어 같은 문구의 409로 막는다. 살아 있는 포크는 ForkUseCase.startFork가 내 목록으로 먼저 거르므로, 요청까지 온 이 거절은 삭제한 포크 때문이다.
 * ponytail: 두 제출이 동시에 겹치면 살아 있는 포크도 이 안내가 나온다. 서버가 두 경우를 가르는 코드를 주면 그 코드로 바꾼다.
 */
const FORK_EXISTS = '이미 만든 분기 작품이 있어요.'
const FORK_DELETED = '이 원작에서 만든 포크를 삭제한 적이 있어 다시 만들 수 없어요.'

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
  async readWork(id: string) { return mapReadingWork(await this.api.readingOne(id)) }
  async listWorlds() { return [] }
  async readWorld(work: Work, episode: number) {
    if (work.private || episode < 1 || epsOf(work)[episode-1]?.hidden) return work
    const world = await this.api.readingWorld(work.id, episode)
    if (world.episode !== episode) throw new Error('세계관 응답의 기준 회차를 확인할 수 없어요.')
    return withReadingWorld(work, world)
  }
  async readWorldCards(workId: string, upto?: number) {
    const cards = await this.api.readingWorldCards(workId, upto)
    if (cards.workId !== workId) throw new Error('세계관 응답의 작품을 확인할 수 없어요.')
    return cards
  }
  async createFork(id: string, episode: number, title: string, direction: string) {
    try {
      const made = await this.api.fork(id, episode, title, direction)
      return { id: made.id }
    } catch (error) {
      throw error instanceof Error && error.message === FORK_EXISTS ? new Error(FORK_DELETED) : error
    }
  }
  async getDraft(key: string): Promise<Draft | undefined> {
    const [id, selected] = key.split(':ep:')
    const rows = await this.api.writingList(id)
    const row = selected ? rows.find(e => e.number === +selected) : [...rows].reverse().find(e => !e.inherited && e.hasDraft !== false)
    if (!row || row.hasDraft === false) return undefined
    return { no: row.number, title: row.draft.title, paras: row.draft.body ? row.draft.body.split('\n\n') : [], authorNote: row.draft.authorNote ?? '',
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

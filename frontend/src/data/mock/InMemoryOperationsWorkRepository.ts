import { OperationsError, OperationsRejected } from '../../domain/entities/operations'
import { EPISODE_INHERITED_MESSAGE, type OperationsEpisode, type OperationsWork } from '../../domain/entities/operationsWork'
import type { Work } from '../../domain/entities/work'
import type { OperationsWorkRepository } from '../../domain/repositories/OperationsWorkRepository'
import { MESSAGES } from '../api/operationsApi'
import type { MockDb } from './InMemoryRepositories'

const toOperationsWork = (w: Work): OperationsWork => ({
  workId: w.id, ownerId: w.owner ?? '', title: w.title, authorName: w.author,
  originKind: w.parent ? 'fork' : 'original',
  creationType: w.kind === '자체 창작' ? 'original' : 'external_derivative',
  rightsConfirmed: w.rights === '확인됨',
  visibility: w.private ? 'private' : 'public',
  restricted: !!w.hidden,
})

/** 서버 없는 시연(`--mode mockup`)·렌더 테스트용입니다. 데모 작품 DB를 운영 작품 형태로 보여 주고, 운영 제한은 데모 작품의 hidden(공개 제외)으로 반영합니다. */
export class InMemoryOperationsWorkRepository implements OperationsWorkRepository {
  private readonly db: MockDb
  /** 운영 제한한 회차(`작품id:번호`). 데모 회차 뷰어는 읽지 않으므로 이 화면의 표시에만 쓴다. */
  private readonly restrictedEpisodes = new Set<string>()
  constructor(db: MockDb) { this.db = db }

  async list() { return this.db.works.map(toOperationsWork) }
  async forkIntegrity(): Promise<never> { throw new OperationsRejected('데모에서는 포크 정합성 점검을 지원하지 않아요.') }
  /** 포크가 물려받은 회차(snap)가 앞에 오고 자기 회차가 이어진다. 데모 작품은 모두 발행 회차다. */
  async episodes(workId: string): Promise<OperationsEpisode[]> {
    const work = this.db.works.find((w) => w.id === workId)
    if (!work) throw new OperationsError(MESSAGES[404])
    const inherited = work.snap?.eps ?? []
    return [...inherited, ...work.eps].map((e, i) => ({ number: i + 1, title: e.t, publicationStatus: 'published', restricted: this.restrictedEpisodes.has(`${workId}:${i + 1}`), inherited: i < inherited.length }))
  }
  async setEpisodeRestriction(workId: string, number: number, restricted: boolean) {
    const episode = (await this.episodes(workId)).find((e) => e.number === number)
    if (!episode) throw new OperationsError(MESSAGES[404])
    if (episode.inherited) throw new OperationsRejected(EPISODE_INHERITED_MESSAGE)
    const key = `${workId}:${number}`
    if (restricted) this.restrictedEpisodes.add(key)
    else this.restrictedEpisodes.delete(key)
  }
  async setRestriction(id: string, restricted: boolean) {
    const work = this.db.works.find((w) => w.id === id)
    if (!work) throw new OperationsError('대상을 찾을 수 없어요. 목록을 새로고침해 주세요.')
    work.hidden = restricted
  }
}

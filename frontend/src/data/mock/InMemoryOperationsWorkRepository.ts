import { OperationsError } from '../../domain/entities/operations'
import type { OperationsWork } from '../../domain/entities/operationsWork'
import type { Work } from '../../domain/entities/work'
import type { OperationsWorkRepository } from '../../domain/repositories/OperationsWorkRepository'
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
  constructor(db: MockDb) { this.db = db }

  async list() { return this.db.works.map(toOperationsWork) }
  async forkIntegrity() { throw new OperationsError('데모에서는 포크 정합성 점검을 지원하지 않아요.') }
  async setRestriction(id: string, restricted: boolean) {
    const work = this.db.works.find((w) => w.id === id)
    if (!work) throw new OperationsError('대상을 찾을 수 없어요. 목록을 새로고침해 주세요.')
    work.hidden = restricted
  }
}

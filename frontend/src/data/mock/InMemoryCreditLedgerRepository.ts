import type { CreditLedgerRepository } from '../../domain/repositories/CreditLedgerRepository'
import type { MockDb } from './InMemoryRepositories'

/** `--mode mockup` 대역: 스튜디오 데모가 쓰는 데모 크레딧 잔액만 보여 줍니다. 지급·사용·소멸 내역은 만들지 않습니다. */
export class InMemoryCreditLedgerRepository implements CreditLedgerRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }
  async balance() { return { total: this.db.credits.credits, items: [] } }
  async history() { return [] }
}

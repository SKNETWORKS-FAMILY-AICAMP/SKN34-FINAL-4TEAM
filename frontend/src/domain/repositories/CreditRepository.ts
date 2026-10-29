import type { DemoCredits } from '../entities/credit'

export interface CreditRepository {
  get(): Promise<DemoCredits>
  save(state: DemoCredits): Promise<void>
}

import { OperationsRejected } from '../entities/operations'
import type { ForkIntegrityResult } from '../entities/operationsWork'
import type { OperationsWorkRepository } from '../repositories/OperationsWorkRepository'

/** 운영 작품 조회와 운영 제한·해제(74). 권한 검사와 실제 제한은 서버가 합니다. */
export class OperationsWorkUseCase {
  private readonly repository: OperationsWorkRepository
  constructor(repository: OperationsWorkRepository) { this.repository = repository }

  list() { return this.repository.list() }
  /** 서버가 점검할 수 없다고 안내한 포크는 그 문구를 결과로 돌려주고, 그 밖의 실패는 그대로 던져 다시 시도하게 합니다. */
  async forkIntegrity(id: string): Promise<ForkIntegrityResult> {
    try {
      return { available: true, report: await this.repository.forkIntegrity(id) }
    } catch (error) {
      if (error instanceof OperationsRejected) return { available: false, message: error.message }
      throw error
    }
  }
  setRestriction(id: string, restricted: boolean) { return this.repository.setRestriction(id, restricted) }
}

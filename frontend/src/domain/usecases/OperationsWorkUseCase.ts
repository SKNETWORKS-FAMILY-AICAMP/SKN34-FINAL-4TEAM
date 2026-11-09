import type { OperationsWorkRepository } from '../repositories/OperationsWorkRepository'

/** 운영 작품 조회와 운영 제한·해제(74). 권한 검사와 실제 제한은 서버가 합니다. */
export class OperationsWorkUseCase {
  private readonly repository: OperationsWorkRepository
  constructor(repository: OperationsWorkRepository) { this.repository = repository }

  list() { return this.repository.list() }
  setRestriction(id: string, restricted: boolean) { return this.repository.setRestriction(id, restricted) }
}

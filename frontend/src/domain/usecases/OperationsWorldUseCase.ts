import { orNullIfForbidden } from '../entities/operations'
import type { OperationsWorldRepository } from '../repositories/OperationsWorldRepository'

/** 운영 세계관 조회와 공개 경로 제한·해제. 권한 검사와 실제 제한은 서버가 합니다. */
export class OperationsWorldUseCase {
  private readonly repository: OperationsWorldRepository
  constructor(repository: OperationsWorldRepository) { this.repository = repository }

  /** 조회 권한(작품 관리)이 없으면(403) 실패가 아니라 null이라, 화면이 다시 불러오기 대신 권한 안내를 보입니다. */
  list() { return orNullIfForbidden(this.repository.list()) }
  setRestriction(worldId: string, restricted: boolean) { return this.repository.setRestriction(worldId, restricted) }
}

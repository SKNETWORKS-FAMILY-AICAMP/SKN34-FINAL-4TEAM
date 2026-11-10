import type { AdminActivityRepository } from '../repositories/AdminActivityRepository'

/** 관리자 활동 기록 조회(72). 기록은 서버가 조치 성공 뒤 남기며 화면에는 수정·삭제가 없습니다. */
export class AdminActivityUseCase {
  private readonly repository: AdminActivityRepository
  constructor(repository: AdminActivityRepository) { this.repository = repository }

  list() { return this.repository.list() }
}

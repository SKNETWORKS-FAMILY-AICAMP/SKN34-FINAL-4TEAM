import type { AdminActivity } from '../entities/adminActivity'
import { OperationsForbidden } from '../entities/operations'
import type { AdminActivityRepository } from '../repositories/AdminActivityRepository'

/** 관리자 활동 기록 조회(72). 기록은 서버가 조치 성공 뒤 남기며 화면에는 수정·삭제가 없습니다. */
export class AdminActivityUseCase {
  private readonly repository: AdminActivityRepository
  constructor(repository: AdminActivityRepository) { this.repository = repository }

  /** 조회 권한(`admins`)이 없으면(403) 실패가 아니라 null이라, 화면이 다시 불러오기 대신 권한 안내를 보입니다. */
  async list(): Promise<AdminActivity[] | null> {
    try {
      return await this.repository.list()
    } catch (error) {
      if (error instanceof OperationsForbidden) return null
      throw error
    }
  }
}

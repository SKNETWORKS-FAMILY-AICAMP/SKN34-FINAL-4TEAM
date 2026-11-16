import type { OperationsCommentRepository } from '../repositories/OperationsCommentRepository'

/** 운영 댓글 조회와 숨김·게시 복구(75). 권한 검사와 실제 숨김은 서버가 합니다. */
export class OperationsCommentUseCase {
  private readonly repository: OperationsCommentRepository
  constructor(repository: OperationsCommentRepository) { this.repository = repository }

  list() { return this.repository.list() }
  hide(id: string) { return this.repository.hide(id) }
  unhide(id: string) { return this.repository.unhide(id) }
}

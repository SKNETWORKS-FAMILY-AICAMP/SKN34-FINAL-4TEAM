import { OperationsError } from '../../domain/entities/operations'
import type { OperationsComment } from '../../domain/entities/operationsComment'
import type { OperationsCommentRepository } from '../../domain/repositories/OperationsCommentRepository'
import { InMemoryAdminRepository, type MockDb } from './InMemoryRepositories'

/**
 * 서버 없는 시연(`--mode mockup`)·렌더 테스트용입니다. 기존 데모 관리자 댓글(시드 + 이 브라우저에서 단 댓글)을 운영 댓글 형태로 보여 주고,
 * 숨김은 데모 회차 뷰어가 이미 읽는 admin.hiddenComments에 반영합니다. 데모 댓글은 회차 구분과 작성 시각이 없어 1회차·고정 시각으로 둡니다
 * (공감이 같으면 목록 순서를 그대로 둡니다).
 */
export class InMemoryOperationsCommentRepository implements OperationsCommentRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }

  async list() {
    const hidden = this.db.admin.hiddenComments
    return (await new InMemoryAdminRepository(this.db).listComments(this.db.works)).map((c): OperationsComment => ({
      commentId: c.id, workId: c.workId, workTitle: c.work, episodeNumber: 1, authorId: c.author, authorName: c.author,
      body: c.text, likeCount: c.likes, hidden: hidden.includes(c.id), createdAt: '2026-11-01T00:00:00Z',
    }))
  }
  hide(id: string) { return this.setHidden(id, true) }
  unhide(id: string) { return this.setHidden(id, false) }

  private async setHidden(id: string, hidden: boolean) {
    if (!(await this.list()).some((c) => c.commentId === id)) throw new OperationsError('대상을 찾을 수 없어요. 목록을 새로고침해 주세요.')
    const rest = this.db.admin.hiddenComments.filter((x) => x !== id)
    this.db.admin.hiddenComments = hidden ? [...rest, id] : rest
  }
}

import type { AdminComment, AdminState } from '../entities/admin'
import type { Work } from '../entities/work'

/** 목업 S.admin·NOTICE·EVENTS 저장소 계약 */
export interface AdminRepository {
  get(): Promise<AdminState>
  save(state: AdminState): Promise<void>
  /** 목업 A.comments: 예시 댓글과 이 브라우저에서 단 댓글 (상태 제외) */
  listComments(works: Work[]): Promise<Omit<AdminComment, 'status'>[]>
}

import type { WorkNotice, WorkNoticeInput } from '../entities/workNotice'

/** 작품 소식 저장소 계약([작품 소식 계약](../../../../docs/design/work-notice-contract.md)). 서버 구현은 모두 Content 공개 API다. */
export interface WorkNoticeRepository {
  /** 공개 작품의 소식(고정 먼저, 그 안에서 최신 먼저, 최대 200개). 익명도 읽는다. */
  list(workId: string, signal?: AbortSignal): Promise<WorkNotice[]>
  create(workId: string, input: WorkNoticeInput, signal?: AbortSignal): Promise<WorkNotice>
  /** 전체 수정(고정 설정·해제 포함). */
  update(workId: string, noticeId: string, input: WorkNoticeInput, signal?: AbortSignal): Promise<WorkNotice>
  remove(workId: string, noticeId: string, signal?: AbortSignal): Promise<void>
}

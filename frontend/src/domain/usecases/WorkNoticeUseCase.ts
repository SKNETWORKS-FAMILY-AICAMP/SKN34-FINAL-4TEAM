import { noticeInput, noticeInputError, type WorkNotice, type WorkNoticeInput } from '../entities/workNotice'
import type { WorkNoticeRepository } from '../repositories/WorkNoticeRepository'

/** 입력이 규칙을 어기면 저장소를 부르기 전에 안내 문구로 던지고, 통과하면 앞뒤 공백을 지운 네 필드만 돌려준다. */
function check(input: WorkNoticeInput): WorkNoticeInput {
  const error = noticeInputError(input)
  if (error) throw new Error(error)
  return noticeInput({ ...input, title: input.title.trim(), body: input.body.trim() })
}

/** 작품 소식: 목록·작성·수정·고정 전환·삭제. 실제 작품은 Content API, 데모 작품은 메모리 저장소가 같은 계약을 따른다. */
export class WorkNoticeUseCase {
  private readonly repository: WorkNoticeRepository
  constructor(repository: WorkNoticeRepository) {
    this.repository = repository
  }

  list(workId: string, signal?: AbortSignal) {
    return this.repository.list(workId, signal)
  }

  async create(workId: string, input: WorkNoticeInput, signal?: AbortSignal) {
    return this.repository.create(workId, check(input), signal)
  }

  async update(notice: WorkNotice, input: WorkNoticeInput, signal?: AbortSignal) {
    return this.repository.update(notice.workId, notice.id, check(input), signal)
  }

  /** 수정이 전체 교체라 지금 내용을 그대로 두고 고정 여부만 뒤집어 보낸다. */
  togglePin(notice: WorkNotice, signal?: AbortSignal) {
    return this.repository.update(notice.workId, notice.id, noticeInput({ ...notice, pinned: !notice.pinned }), signal)
  }

  remove(notice: WorkNotice, signal?: AbortSignal) {
    return this.repository.remove(notice.workId, notice.id, signal)
  }
}

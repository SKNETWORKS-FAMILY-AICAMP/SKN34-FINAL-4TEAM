import { OperationsError, type NoticeInput, type OperationsNotice } from '../entities/operations'
import type { NoticeRepository } from '../repositories/NoticeRepository'

/** 운영 공지 등록·수정·삭제와 독자 조회. 입력 규칙은 서버(제목 1~200자·본문 1~20000자)와 같다. */
export class NoticeUseCase {
  private readonly repository: NoticeRepository
  constructor(repository: NoticeRepository) { this.repository = repository }

  list() { return this.repository.list() }
  /** id가 없으면 새로 등록하고, 있으면 전체 수정한다. 제목만 앞뒤 공백을 지운다. */
  async save(id: string | null, input: NoticeInput): Promise<OperationsNotice> {
    // ponytail: OperationsUseCase(메모리 공지)와 같은 검증을 복제했다. #67 병합 뒤 그쪽 공지 메서드를 지우면 이 파일이 단일 출처다.
    const title = input.title.trim()
    if (!title || title.length > 200) throw new OperationsError('제목은 1~200자로 입력해 주세요.')
    if (!input.body.trim() || input.body.length > 20000) throw new OperationsError('내용은 1~20000자로 입력해 주세요.')
    return id ? this.repository.update(id, { title, body: input.body }) : this.repository.create({ title, body: input.body })
  }
  delete(id: string) { return this.repository.delete(id) }
  listPublic() { return this.repository.listPublic() }
  getPublic(id: string) { return this.repository.getPublic(id) }
}

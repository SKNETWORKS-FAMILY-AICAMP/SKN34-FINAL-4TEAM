import type { WorkInterestRepository } from '../repositories/WorkInterestRepository'

/** 기능 21-B: 작품 화면의 관심 등록/해제. 서재의 관심 소설 목록은 LibraryUseCase가 같은 저장소로 읽습니다. */
export class WorkInterestUseCase {
  private readonly repository: WorkInterestRepository
  constructor(repository: WorkInterestRepository) {
    this.repository = repository
  }

  async isInterested(workId: string, signal?: AbortSignal) {
    return (await this.repository.list(signal)).includes(workId)
  }

  /** 켜면 관심 작품에 담고 끄면 뺍니다. 실패는 호출자에게 그대로 알립니다. */
  setInterested(workId: string, on: boolean) {
    return on ? this.repository.add(workId) : this.repository.remove(workId)
  }
}

import type { AdminRepository } from '../repositories/AdminRepository'
import type { EpisodeRepository } from '../repositories/EpisodeRepository'
import type { WorkInterestRepository } from '../repositories/WorkInterestRepository'
import type { WorkRepository } from '../repositories/WorkRepository'

/** 목업 mePage(): U30~U33·U35·U35E 계정 메뉴의 데이터. 문의하기(U34)는 SupportInquiryUseCase가 맡습니다. */
export class AccountUseCase {
  private readonly workRepository: WorkRepository
  private readonly interestRepository: WorkInterestRepository
  private readonly adminRepository: AdminRepository
  private readonly storageRepository: Pick<EpisodeRepository, 'storageUsage'>
  constructor(workRepository: WorkRepository, interestRepository: WorkInterestRepository, adminRepository: AdminRepository, storageRepository: Pick<EpisodeRepository, 'storageUsage'>) {
    this.workRepository = workRepository
    this.interestRepository = interestRepository
    this.adminRepository = adminRepository
    this.storageRepository = storageRepository
  }

  /** U32 관심 소설: 서버 관심 목록(최근 등록순, 서재 U11과 같은 출처). 읽지 못하면 빈 목록으로 숨기지 않고 던집니다. */
  async liked() {
    const [works, ids] = await Promise.all([this.workRepository.listWorks(), this.interestRepository.list()])
    return ids.flatMap((id) => works.filter((w) => w.id === id))
  }

  /** U30 저장 공간: 로그인 회원 본인의 저장 항목(Content 집계). */
  storage(signal?: AbortSignal) { return this.storageRepository.storageUsage(signal) }

  /** U35E: 관리자가 게시한 이벤트(메모리 데모). 공지(U35)는 NoticeUseCase가 운영 공지 API로 읽습니다. */
  async events() { return (await this.adminRepository.get()).events }
}

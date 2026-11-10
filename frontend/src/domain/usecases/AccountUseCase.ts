import { isMine } from '../entities/work'
import type { AdminRepository } from '../repositories/AdminRepository'
import type { WorkInterestRepository } from '../repositories/WorkInterestRepository'
import type { WorkRepository } from '../repositories/WorkRepository'
import type { WorldRepository } from '../repositories/WorldRepository'

/** 목업 mePage(): U30~U33·U35·U35E 계정 메뉴의 데이터. 문의하기(U34)는 SupportInquiryUseCase가 맡습니다. */
export class AccountUseCase {
  private readonly workRepository: WorkRepository
  private readonly worldRepository: WorldRepository
  private readonly interestRepository: WorkInterestRepository
  private readonly adminRepository: AdminRepository
  constructor(workRepository: WorkRepository, worldRepository: WorldRepository, interestRepository: WorkInterestRepository, adminRepository: AdminRepository) {
    this.workRepository = workRepository
    this.worldRepository = worldRepository
    this.interestRepository = interestRepository
    this.adminRepository = adminRepository
  }

  /** U32 관심 소설: 서버 관심 목록(최근 등록순, 서재 U11과 같은 출처). 읽지 못하면 빈 목록으로 숨기지 않고 던집니다. */
  async liked() {
    const [works, ids] = await Promise.all([this.workRepository.listWorks(), this.interestRepository.list()])
    return ids.flatMap((id) => works.filter((w) => w.id === id))
  }

  /** 저장 공간: 메모리 데모 데이터 크기 예시와 작성 중인 초안 (관리 기능은 MVP 제외) */
  async storage() {
    const [works, worlds, all] = await Promise.all([this.workRepository.listWorks(), this.worldRepository.list(), this.workRepository.listDrafts()])
    const drafts = Object.entries(all).flatMap(([key, d]) => { const w = works.find((x) => x.id === key.split(':ep:')[0]); return w && isMine(w) ? [{ key, title: w.title, d }] : [] })
    const bytes = new Blob([JSON.stringify({ works: works.filter(isMine), worlds: worlds.filter((w) => !w.owner), drafts: drafts.map((x) => [x.key, x.d]) })]).size
    return { bytes, drafts }
  }

  /** U35E: 관리자가 게시한 이벤트(메모리 데모). 공지(U35)는 NoticeUseCase가 운영 공지 API로 읽습니다. */
  async events() { return (await this.adminRepository.get()).events }
}

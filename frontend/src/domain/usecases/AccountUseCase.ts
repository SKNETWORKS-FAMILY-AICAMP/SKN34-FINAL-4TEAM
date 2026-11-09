import { isMine } from '../entities/work'
import type { AdminRepository } from '../repositories/AdminRepository'
import type { ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import type { WorldRepository } from '../repositories/WorldRepository'

/** 목업 mePage(): U30~U33·U35·U35E 계정 메뉴의 데이터. 문의하기(U34)는 SupportInquiryUseCase가 맡습니다. */
export class AccountUseCase {
  private readonly workRepository: WorkRepository
  private readonly worldRepository: WorldRepository
  private readonly readingRepository: ReadingRepository
  private readonly adminRepository: AdminRepository
  constructor(workRepository: WorkRepository, worldRepository: WorldRepository, readingRepository: ReadingRepository, adminRepository: AdminRepository) {
    this.workRepository = workRepository
    this.worldRepository = worldRepository
    this.readingRepository = readingRepository
    this.adminRepository = adminRepository
  }

  /** U32 관심 소설: 목업처럼 처음 누른 순서 */
  async liked() {
    const [works, p] = await Promise.all([this.workRepository.listWorks(), this.readingRepository.getProgress()])
    return Object.keys(p.liked).filter((k) => p.liked[k]).flatMap((k) => works.filter((w) => w.id === k))
  }

  /** 저장 공간: 메모리 데모 데이터 크기 예시와 작성 중인 초안 (관리 기능은 MVP 제외) */
  async storage() {
    const [works, worlds, all] = await Promise.all([this.workRepository.listWorks(), this.worldRepository.list(), this.workRepository.listDrafts()])
    const drafts = Object.entries(all).flatMap(([key, d]) => { const w = works.find((x) => x.id === key.split(':ep:')[0]); return w && isMine(w) ? [{ key, title: w.title, d }] : [] })
    const bytes = new Blob([JSON.stringify({ works: works.filter(isMine), worlds: worlds.filter((w) => !w.owner), drafts: drafts.map((x) => [x.key, x.d]) })]).size
    return { bytes, drafts }
  }

  /** U35·U35E: 관리자가 게시한 공지·이벤트를 포함합니다. */
  async board() { const { notices, events } = await this.adminRepository.get(); return { notices, events } }
}

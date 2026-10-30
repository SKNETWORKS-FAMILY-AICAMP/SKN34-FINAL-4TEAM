import type { Inquiry } from '../entities/account'
import { isMine, nid } from '../entities/work'
import type { InquiryRepository } from '../repositories/InquiryRepository'
import type { ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import type { WorldRepository } from '../repositories/WorldRepository'

/** 목업 mePage(): U30~U35E 계정 메뉴의 데이터 */
export class AccountUseCase {
  private readonly workRepository: WorkRepository
  private readonly worldRepository: WorldRepository
  private readonly readingRepository: ReadingRepository
  private readonly inquiryRepository: InquiryRepository
  constructor(workRepository: WorkRepository, worldRepository: WorldRepository, readingRepository: ReadingRepository, inquiryRepository: InquiryRepository) {
    this.workRepository = workRepository
    this.worldRepository = worldRepository
    this.readingRepository = readingRepository
    this.inquiryRepository = inquiryRepository
  }

  /** U32 관심 소설 */
  async liked() {
    const [works, p] = await Promise.all([this.workRepository.listWorks(), this.readingRepository.getProgress()])
    return works.filter((w) => p.liked[w.id])
  }

  /** 저장 공간: 메모리 데모 데이터 크기 예시와 작성 중인 초안 (관리 기능은 MVP 제외) */
  async storage() {
    const [works, worlds, all] = await Promise.all([this.workRepository.listWorks(), this.worldRepository.list(), this.workRepository.listDrafts()])
    const drafts = Object.entries(all).flatMap(([key, d]) => { const w = works.find((x) => x.id === key.split(':ep:')[0]); return w && isMine(w) ? [{ key, title: w.title, d }] : [] })
    const bytes = new Blob([JSON.stringify({ works: works.filter(isMine), worlds: worlds.filter((w) => !w.owner), drafts: drafts.map((x) => [x.key, x.d]) })]).size
    return { bytes, drafts }
  }

  inquiries() { return this.inquiryRepository.list() }

  /** 목업 #iqf 제출. 문제가 있으면 안내 문구 */
  async ask(t: string, s: string, b: string): Promise<string> {
    if (!s.trim() || !b.trim()) return '제목과 내용을 입력해 주세요'
    const q: Inquiry = { id: nid('q'), t, s: s.trim(), b: b.trim(), d: new Intl.DateTimeFormat('sv-SE').format(new Date()).replaceAll('-', '.'), st: '답변 대기' }
    await this.inquiryRepository.add(q)
    return '문의를 보냈어요 (데모 · 실제 전송 없음)'
  }
}

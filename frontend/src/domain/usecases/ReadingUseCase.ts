import { epsOf, forksOf, isPub, originals, visibleEpisode, type Role, type Work } from '../entities/work'
import type { ReadingRepository, WorkRepository } from '../repositories/WorkRepository'

/** 목업 CHIPS: 홈 장르 칩과 필터 조건 */
export const HOME_CHIPS: [string, ((w: Work, all: Work[]) => boolean) | null][] = [
  ['추천', null],
  ['📜 고전', (w) => w.theme === 'hanji'],
  ['✨ 판타지', (w) => /판타지/.test(w.genre)],
  ['🛰 SF', (w) => /SF/.test(w.genre)],
  ['🆓 무료', (w) => w.tags.includes('free')],
  ['✎ 포크 많은', (w, all) => forksOf(all, w.id).length > 0],
]

export class ReadingUseCase {
  private readonly workRepository: WorkRepository
  private readonly readingRepository: ReadingRepository
  constructor(workRepository: WorkRepository, readingRepository: ReadingRepository) {
    this.workRepository = workRepository
    this.readingRepository = readingRepository
  }

  /** 목업 home(): 칩이 '추천'이 아니면 filtered(U02)만 채웁니다. */
  async getHome(role: Role, chip: string) {
    const [works, progress] = await Promise.all([this.workRepository.listWorks(), this.readingRepository.getProgress()])
    const pub = works.filter(isPub)
    const filter = (HOME_CHIPS.find((c) => c[0] === chip) ?? HOME_CHIPS[0])[1]
    const origs = originals(works)
    const lastId = Object.keys(progress.last).find((id) => {
      const w = works.find((x) => x.id === id)
      const e = w && isPub(w) && epsOf(w)[progress.last[id] - 1]
      return !!w && !!e && visibleEpisode(w, e, role)
    })
    const lastWork = works.find((w) => w.id === lastId)
    const pick = (ids: string[]) => ids.map((id) => works.find((w) => w.id === id)).filter((w): w is Work => !!w)
    return {
      works,
      seen: progress.seen,
      filtered: filter ? pub.filter((w) => filter(w, works)) : null,
      originals: origs,
      forkFeed: pub.filter((w) => w.parent).sort((a, b) => a.upd - b.upd),
      continueReading: lastWork ? { work: lastWork, episode: progress.last[lastWork.id] } : null,
      top10: pub.slice().sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 10),
      rising: origs.slice().sort((a, b) => b.views - a.views),
      fresh: pub.slice().sort((a, b) => a.upd - b.upd).slice(0, 5),
      picks: pick(['guunmong', 'postman', 'gate', 'hong', 'crown', 'starlight']),
      discover: pub,
      weekly: pick(['guunmong', 'hong', 'postman', 'starlight']),
    }
  }

  markSeen(workId: string) {
    return this.readingRepository.markSeen(workId)
  }
}

import { splitSentences } from '../entities/feedback'
import { canView, epsOf, forkLabel, forkList, forkOK, forksOf, isPub, matchW, originals, publicCast, sorter, tagsOf, visibleEpisode, type Role, type Work } from '../entities/work'
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

  private async load(id: string) {
    const [works, worlds, progress] = await Promise.all([this.workRepository.listWorks(), this.workRepository.listWorlds(), this.readingRepository.getProgress()])
    return { works, worlds, progress, w: works.find((x) => x.id === id) }
  }

  /** 목업 work(): 볼 수 없는 작품이면 null (unavailableWork) */
  async getWork(id: string, role: Role) {
    const { works, worlds, progress, w } = await this.load(id)
    if (!canView(w, role)) return null
    const forks = forksOf(works, id)
    return {
      work: w,
      parent: works.find((x) => x.id === w.parent),
      visible: epsOf(w).map((e, i) => [e, i] as const).filter(([e]) => visibleEpisode(w, e, role)),
      last: progress.last[id] as number | undefined,
      read: progress.read[id] ?? [],
      liked: !!progress.liked[id],
      forks,
      forkList: forkList(w, worlds),
      topForks: forks.slice().sort((a, b) => b.likes - a.likes),
    }
  }

  /**
   * 목업 reader(): 회차를 열면서 이어 읽기(last)와 읽음(read)을 기록합니다.
   * 볼 수 없는 작품은 null, 숨긴 회차는 'hidden'(상세로 보냄)입니다.
   */
  async openEpisode(id: string, at: number, role: Role) {
    const { works, worlds, progress, w } = await this.load(id)
    if (!canView(w, role)) return null
    const eps = epsOf(w)
    const n = Math.max(1, Math.min(+at || 1, eps.length))
    const ep = eps[n - 1]
    if (!ep || !visibleEpisode(w, ep, role)) return 'hidden' as const
    const shown = eps.map((e, i) => [e, i + 1] as const).filter(([e]) => visibleEpisode(w, e, role)).map(([, i]) => i)
    const { [id]: prev = 0, ...others } = progress.last
    progress.last = { [id]: Math.max(n, prev), ...others }
    const read = (progress.read[id] ??= [])
    if (!read.includes(n)) read.push(n)
    await this.readingRepository.saveProgress(progress)
    return {
      work: w,
      n,
      ep,
      paragraphs: splitSentences(ep.p),
      previous: shown.filter((i) => i < n).at(-1) ?? null,
      next: shown.find((i) => i > n) ?? null,
      forks: w.parent ? [] : forksOf(works, id).filter((f) => f.forkAt === n),
      canFork: forkOK(w, n, worlds),
    }
  }

  async toggleLike(id: string) {
    const progress = await this.readingRepository.getProgress()
    progress.liked[id] = !progress.liked[id]
    await this.readingRepository.saveProgress(progress)
    return progress.liked[id]
  }

  /** 목업 searchPage()·rank(): t는 랭킹 탭(all·orig·if) */
  async findWorks({ t = 'all', q = '', f = 'all', sort }: { t?: string; q?: string; f?: string; sort: string }) {
    const works = await this.workRepository.listWorks()
    return works.filter(isPub)
      .filter((w) => t === 'all' || (t === 'orig' ? !w.parent : !!w.parent))
      .filter((w) => matchW(w, q, f, works))
      .sort(sorter(sort))
  }

  /** 목업 tagPage(t): 태그가 없으면 첫 태그를 고릅니다. */
  async getTag(tag?: string) {
    const works = await this.workRepository.listWorks()
    const pub = works.filter(isPub)
    const all: Record<string, number> = {}
    for (const w of pub) for (const h of tagsOf(w, works)) all[h] = (all[h] || 0) + 1
    const cur = tag ? '#' + tag : Object.keys(all)[0]
    return {
      cur,
      tags: Object.entries(all).sort((a, b) => b[1] - a[1]),
      list: pub.filter((w) => tagsOf(w, works).includes(cur)).sort((a, b) => (b.likes || 0) - (a.likes || 0)).map((w) => ({ w, tags: tagsOf(w, works) })),
    }
  }

  /** 목업 ifs(): 공개 원작 하나와 그 포크 */
  async getForkCollection(id: string, sort: string) {
    const [works, worlds] = await Promise.all([this.workRepository.listWorks(), this.workRepository.listWorlds()])
    return originals(works).filter(isPub).filter((o) => o.id === id).map((o) => ({
      o, label: forkLabel(o, worlds), forkList: forkList(o, worlds), forks: forksOf(works, o.id).sort(sorter(sort)),
    }))
  }

  /** 목업 quick(): 빠른 이동 후보 (소설·인물·회차) */
  async getQuickItems(role: Role) {
    const works = await this.workRepository.listWorks()
    const items: { k: string; w?: Work; label: string; sub: string; go: string }[] = []
    for (const w of works.filter(isPub)) {
      items.push({ k: '소설', w, label: w.title, sub: `${w.author} · ${w.genre}`, go: `/work/${w.id}` })
      if (w.parent) continue
      for (const c of publicCast(w, w.eps.length)) items.push({ k: '인물', w, label: c.n, sub: `${w.title} · ${c.d}`, go: `/work/${w.id}` })
      w.eps.forEach((e, i) => { if (visibleEpisode(w, e, role)) items.push({ k: '회차', w, label: `${w.title} ${i + 1}화 ${e.t}`, sub: '바로 읽기', go: `/read/${w.id}/${i + 1}` }) })
    }
    return items
  }
}

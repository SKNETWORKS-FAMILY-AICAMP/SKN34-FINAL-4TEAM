import type { Work as ContentWork } from '../entities/content'
import { splitSentences } from '../entities/feedback'
import { baseOf, canView, epsOf, forkLabel, forkList, forkOK, forksOf, isMine, isPub, matchW, originals, publicCast, sorter, tagsOf, visibleEpisode, type Role, type SearchField, type SearchSort, type Work } from '../entities/work'
import type { ReadingRecord, ReadingRecordRepository } from '../repositories/ReadingRecordRepository'
import type { ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import type { WorkSearchRepository } from '../repositories/WorkSearchRepository'

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
  /** 로그인 회원의 이어 읽기·읽은 회차(서버 독서 기록. 목업은 메모리) */
  private readonly readingRecordRepository: ReadingRecordRepository
  /** 있으면 홈 순위·검색을 서버(Content 공개 API)로 채웁니다. 없으면(목업) 메모리 데모입니다. */
  private readonly workSearchRepository?: WorkSearchRepository
  constructor(workRepository: WorkRepository, readingRepository: ReadingRepository, readingRecordRepository: ReadingRecordRepository, workSearchRepository?: WorkSearchRepository) {
    this.workRepository = workRepository
    this.readingRepository = readingRepository
    this.readingRecordRepository = readingRecordRepository
    this.workSearchRepository = workSearchRepository
  }

  /** 로그인 회원의 서버 독서 기록(최근 순). 비회원은 기록이 없고(서버를 부르지 않음), 읽지 못하면 빈 기록으로 숨기지 않고 던집니다. */
  private memberRecords(role: Role): Promise<ReadingRecord[]> {
    return role ? this.readingRecordRepository.list() : Promise.resolve([])
  }

  /** 서버 랭킹(최근 24시간 조회). 실패는 빈 목록으로 숨기지 않고 failed로 알립니다. */
  private serverRanking() {
    const repo = this.workSearchRepository
    if (!repo) return null
    return Promise.all([repo.ranking('top'), repo.ranking('rising')]).then(([top10, rising]) => ({ top10, rising, failed: false }), () => ({ top10: [] as Work[], rising: [] as Work[], failed: true }))
  }

  /** 목업 home(): 칩이 '추천'이 아니면 filtered(U02)만 채웁니다. */
  async getHome(role: Role, chip: string) {
    const [works, progress, ranking, records] = await Promise.all([this.workRepository.listWorks(), this.readingRepository.getProgress(), this.serverRanking(), this.memberRecords(role)])
    const pub = works.filter(isPub)
    const filter = (HOME_CHIPS.find((c) => c[0] === chip) ?? HOME_CHIPS[0])[1]
    const origs = originals(works).filter(isPub)
    const forkSources: Record<string, { title: string; episode: number }> = {}
    // ponytail: 소수 작품의 메모리 데모용 중첩 순회; 서버 목록으로 확장할 때 저장소 조회로 대체합니다.
    for (const w of pub) {
      const parent = pub.find((p) => p.id === w.parent)
      if (parent && w.forkAt) forkSources[w.id] = { title: parent.title, episode: w.forkAt }
    }
    // 서버 기록 중 가장 최근에 읽은 작품의, 지금도 볼 수 있는 이어 읽기 회차
    const resume = records.flatMap((r) => {
      const w = works.find((x) => x.id === r.workId)
      const e = w && isPub(w) && epsOf(w)[r.lastEpisode - 1]
      return w && e && visibleEpisode(w, e, role) ? [{ work: w, episode: r.lastEpisode }] : []
    })[0]
    return {
      works,
      forkSources,
      seen: progress.seen,
      filtered: filter ? pub.filter((w) => filter(w, works)) : null,
      originals: origs,
      forkFeed: pub.filter((w) => w.parent).sort(sorter('new')),
      continueReading: resume ?? null,
      top10: ranking ? ranking.top10 : pub.slice().sort(sorter('pop')).slice(0, 10),
      rising: ranking ? ranking.rising : origs.slice().sort(sorter('view')),
      rankingFailed: !!ranking?.failed,
      /** 순위 섹션이 실제 순위인가: 서버 랭킹이거나 좋아요·조회 지표가 있는 목업. 지표 없는 서버 작품의 단순 목록이면 false입니다. */
      ranked: !!ranking || !pub.some((w) => w.statisticsSupported === false),
      fresh: pub.slice().sort(sorter('new')).slice(0, 5),
      picks: pub.slice(0, 6),
      discover: pub,
      weekly: origs.slice(0, 4),
    }
  }

  markSeen(workId: string) {
    return this.readingRepository.markSeen(workId)
  }

  /**
   * 공개 열람 화면이 여는 작품의 조회를 기록합니다. 화면이 전체 회차를 한 번에 보여 주므로 긴 작품이 24시간 랭킹을
   * 부풀리지 않게 상속이 아닌 첫 발행 회차 1건만 보냅니다(서버가 회원·회차·하루 1회로 거르니 작품당 회원 하루 1회 효과).
   * 상속 회차는 원작의 것이라 제외하고, 실패는 읽기를 막지 않으므로 삼킵니다.
   */
  async recordViews(work: Pick<ContentWork, 'id' | 'readOnly' | 'episodes'>) {
    const repo = this.workSearchRepository
    const first = work.episodes.find((e) => !e.inherited)
    if (!repo || !work.readOnly || !first) return
    await repo.recordView(work.id, first.number).catch(() => {})
  }

  private async load(id: string) {
    const [works, worlds, progress] = await Promise.all([this.workRepository.listWorks(), this.workRepository.listWorlds(), this.readingRepository.getProgress()])
    return { works, worlds, progress, w: works.find((x) => x.id === id || x.slug === id) }
  }

  /** 목업 work(): 볼 수 없는 작품이면 null (unavailableWork) */
  async getWork(id: string, role: Role) {
    const { works, worlds, progress, w: loaded } = await this.load(id)
    if (!canView(loaded, role)) return null
    const [w, records] = await Promise.all([this.workRepository.readWorld(loaded,epsOf(loaded).length), this.memberRecords(role)])
    const record = records.find((r) => r.workId === w.id)
    const forks = forksOf(works, w.id)
    return {
      work: w,
      parent: works.find((x) => x.id === w.parent),
      visible: epsOf(w).map((e, i) => [e, i] as const).filter(([e]) => visibleEpisode(w, e, role)),
      last: record?.lastEpisode,
      read: record?.readEpisodes ?? [],
      liked: !!progress.liked[w.id],
      forks,
      forkList: forkList(w, worlds),
      topForks: forks.slice().sort(sorter('pop')),
    }
  }

  /**
   * 목업 reader(): 회차를 열면서 이어 읽기와 읽음을 서버 독서 기록에 남깁니다. 볼 수 없는 작품은 null,
   * 숨긴 회차는 'hidden'(상세로 보냄)입니다. 기록은 기다리지 않고 회차를 먼저 돌려주며, 저장 결과는 recording으로 받습니다
   * (실패하면 reject하므로 호출자가 알려야 합니다. 기록하지 않는 경우는 바로 끝납니다).
   */
  async openEpisode(id: string, at: number, role: Role) {
    const { works, worlds, w: loaded } = await this.load(id)
    if (!canView(loaded, role)) return null
    const eps = epsOf(loaded)
    const n = Math.max(1, Math.min(+at || 1, eps.length))
    const w = await this.workRepository.readWorld(loaded,n)
    id = w.id
    const ep = eps[n - 1]
    if (!ep || !visibleEpisode(w, ep, role)) return 'hidden' as const
    const shown = eps.map((e, i) => [e, i + 1] as const).filter(([e]) => visibleEpisode(w, e, role)).map(([, i]) => i)
    // 로그인 회원이 공개 작품(상속 회차 포함)의 회차를 열면 기록한다. 이어 읽기 위치는 최댓값이 아니라 방금 연 회차다.
    // 비회원·작가가 자기 비공개 작품을 미리 읽을 때는 서버가 404로 거절하므로 보내지 않는다.
    const recording = role && isPub(w) ? this.readingRecordRepository.record(w.id, n) : Promise.resolve()
    recording.catch(() => {}) // 호출자가 recording을 받지 않아도 처리되지 않은 reject 경고가 나지 않게 한다.
    // 로그인 회원이 서버 작품의 자체 회차를 열면 그 회차의 조회를 기록한다(상속 회차는 원작 몫). 소유자가 여는 비공개 작품은
    // 서버가 404로 거절하므로 공개 작품만 보낸다. 실패는 읽기를 막지 않는다.
    if (role && w.canonical && isPub(w) && n > (w.snap?.eps.length ?? 0)) this.workSearchRepository?.recordView(w.id, n).catch(() => {})
    return {
      work: w,
      n,
      ep,
      paragraphs: splitSentences(ep.p),
      previous: shown.filter((i) => i < n).at(-1) ?? null,
      next: shown.find((i) => i > n) ?? null,
      forks: w.parent ? [] : forksOf(works, id).filter((f) => f.forkAt === n),
      canFork: forkOK(w, n, worlds),
      recording,
    }
  }

  async toggleLike(id: string) {
    const progress = await this.readingRepository.getProgress()
    progress.liked[id] = !progress.liked[id]
    await this.readingRepository.saveProgress(progress)
    return progress.liked[id]
  }

  /** 목업 searchPage()·rank(): t는 랭킹 탭(all·orig·if). 서버 저장소가 있으면 검색은 서버가, 원작·Fork 탭은 결과에서 거릅니다. */
  async findWorks({ t = 'all', q = '', f = 'all', sort }: { t?: string; q?: string; f?: SearchField; sort: SearchSort }) {
    const kind = (w: Work) => t === 'all' || (t === 'orig' ? !w.parent : !!w.parent)
    if (this.workSearchRepository) return (await this.workSearchRepository.search({ q: q.trim(), f, sort })).filter(kind)
    const works = await this.workRepository.listWorks()
    return works.filter(isPub)
      .filter(kind)
      .filter((w) => matchW(w, q, f, works))
      .sort(sorter(sort === 'latest' ? 'new' : sort))
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
      list: pub.filter((w) => tagsOf(w, works).includes(cur)).sort(sorter('pop')).map((w) => ({ w, tags: tagsOf(w, works) })),
    }
  }

  /** 목업 ifs(): 공개 원작 하나와 그 포크 */
  async getForkCollection(id: string, sort: string) {
    const [works, worlds] = await Promise.all([this.workRepository.listWorks(), this.workRepository.listWorlds()])
    return originals(works).filter(isPub).filter((o) => o.id === id || o.slug === id).map((o) => ({
      o, label: forkLabel(o, worlds), forkList: forkList(o, worlds), forks: forksOf(works, o.id).sort(sorter(sort)),
    }))
  }

  /** 목업 quick(): 빠른 이동 후보 (소설·인물·회차). 집필실에서는 탭 이동·인물을 앞에 둡니다. */
  async getQuickItems(role: Role, studio?: { id: string; ep: string | null }) {
    const works = await this.workRepository.listWorks()
    const items: { k: string; w?: Work; label: string; sub: string; go: string }[] = []
    // 목업은 모든 작품에서 넣지만, 비공개 인물이 보이지 않도록 내 작품 집필실에서만 넣습니다.
    const sw = studio && role === 'user' && works.find((w) => w.id === studio.id && isMine(w))
    if (sw) {
      const at = (target: string) => `/studio/${sw.id}?${target}${studio.ep ? `&ep=${studio.ep}` : ''}`
      items.push({ k: '이동', label: 'AI 채팅', sub: '집필실', go: at('panel=chat') }, { k: '이동', label: '플롯', sub: '집필실', go: at('view=narrative') }, { k: '이동', label: '집필 설정', sub: '집필실', go: at('panel=settings') })
      for (const c of baseOf(sw).cast) items.push({ k: '인물', label: c.n, sub: '사전에서 보기', go: at(`view=wiki&q=${encodeURIComponent(c.n)}`) })
    }
    for (const w of works.filter(isPub)) {
      items.push({ k: '소설', w, label: w.title, sub: `${w.author} · ${w.genre}`, go: `/work/${w.id}` })
      if (w.parent) continue
      for (const c of publicCast(w, w.eps.length)) items.push({ k: '인물', w, label: c.n, sub: `${w.title} · ${c.d}`, go: `/work/${w.id}` })
      w.eps.forEach((e, i) => { if (visibleEpisode(w, e, role)) items.push({ k: '회차', w, label: `${w.title} ${i + 1}화 ${e.t}`, sub: '바로 읽기', go: `/read/${w.id}/${i + 1}` }) })
    }
    return items
  }
}

import type { Work as ContentWork } from '../entities/content'
import { readerBody } from '../entities/feedback'
import { baseOf, canView, epsOf, forkLabel, forkList, forkOK, forksOf, isMine, isPub, matchW, originals, publicCast, RANKING_TYPES, rankingUsesPeriod, sameAuthorWorks, similarWorks, sorter, tagsOf, visibleEpisode, type RankingKind, type RankingPeriod, type Role, type SearchField, type SearchSort, type Work } from '../entities/work'
import type { ReadingRecord, ReadingRecordRepository } from '../repositories/ReadingRecordRepository'
import { SessionExpired } from '../repositories/ProfileRepository'
import type { WorkLikeRepository, WorkLikeState } from '../repositories/WorkLikeRepository'
import type { ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import type { WorkRankingQuery, WorkSearchRepository } from '../repositories/WorkSearchRepository'

/** 서버 검색 목록이 한 번에 받는 개수(계약: size 20). 이만큼 받으면 다음 페이지가 있을 수 있다. */
const SEARCH_PAGE_SIZE = 20

/** 목업 CHIPS: 홈 장르 칩과 필터 조건 */
export const HOME_CHIPS: [string, ((w: Work, all: Work[]) => boolean) | null][] = [
  ['추천', null],
  ['📜 고전', (w) => w.theme === 'hanji'],
  ['✨ 판타지', (w) => /판타지/.test(w.genre)],
  ['🛰 SF', (w) => /SF/.test(w.genre)],
  ['🆓 무료', (w) => w.tags.includes('free') || !!w.canonical], // 유료 열람이 없어 서버(canonical) 공개 작품은 모두 무료다.
  ['✎ 포크 많은', (w, all) => forksOf(all, w.id).length > 0],
]

/** 랭킹 범위 탭 t(all·orig·if)에 드는 작품인가 */
const inTab = (t: string) => (w: Work) => t === 'all' || (t === 'orig' ? !w.parent : !!w.parent)
/** 서버 저장소가 있으면 이 칩은 Content 검색(장르 부분 일치·좋아요순)으로 채웁니다. 목업은 위 메모리 필터입니다. */
const HOME_GENRE_QUERIES: Record<string, string> = { '📜 고전': '고전', '✨ 판타지': '판타지', '🛰 SF': 'SF' }

export class ReadingUseCase {
  private readonly workRepository: WorkRepository
  private readonly readingRepository: ReadingRepository
  /** 로그인 회원의 이어 읽기·읽은 회차(서버 독서 기록. 목업은 메모리) */
  private readonly readingRecordRepository: ReadingRecordRepository
  /** 있으면 홈 순위·검색을 서버(Content 공개 API)로 채웁니다. 없으면(목업) 메모리 데모입니다. */
  private readonly workSearchRepository?: WorkSearchRepository
  /** 있으면 서버 작품(canonical)의 좋아요를 Content로 보냅니다. 없으면(목업) 메모리 데모입니다. */
  private readonly workLikeRepository?: WorkLikeRepository
  constructor(workRepository: WorkRepository, readingRepository: ReadingRepository, readingRecordRepository: ReadingRecordRepository, workSearchRepository?: WorkSearchRepository, workLikeRepository?: WorkLikeRepository) {
    this.workRepository = workRepository
    this.readingRepository = readingRepository
    this.readingRecordRepository = readingRecordRepository
    this.workSearchRepository = workSearchRepository
    this.workLikeRepository = workLikeRepository
  }

  /** 로그인 회원의 서버 독서 기록(최근 순). 비회원은 기록이 없고(서버를 부르지 않음), 읽지 못하면 빈 기록으로 숨기지 않고 던집니다. */
  private memberRecords(role: Role): Promise<ReadingRecord[]> {
    return role ? this.readingRecordRepository.list() : Promise.resolve([])
  }

  /**
   * 홈 다섯 줄(실시간 인기·급상승·포크 소설·방금 업데이트·이번 주 인기)을 서버 기간별 랭킹으로 묻습니다(기능표 45 계약).
   * 한 줄의 실패는 빈 목록으로 숨기지 않고 그 줄의 failed로만 알려 홈 전체를 막지 않습니다.
   */
  private async serverHome() {
    const repo = this.workSearchRepository
    if (!repo) return null
    const line = (query: WorkRankingQuery) => repo.rankings(query).then(
      ({ items, computedAt }) => ({ items, computedAt, failed: false }),
      () => ({ items: [] as Work[], computedAt: null, failed: true }),
    )
    const [top10, rising, forkFeed, fresh, weekly] = await Promise.all([
      line({ kind: 'view', period: 'day' }), line({ kind: 'rising', period: 'day' }), line({ kind: 'latest', type: 'fork' }),
      line({ kind: 'updated', limit: 5 }), line({ kind: 'popular', period: 'week', limit: 4 }),
    ])
    return { top10, rising, forkFeed, fresh, weekly }
  }

  /** 목업 home(): 칩이 '추천'이 아니면 filtered(U02)만 채웁니다. */
  async getHome(role: Role, chip: string) {
    const repo = this.workSearchRepository
    const genre = HOME_GENRE_QUERIES[chip]
    const [works, progress, server, records, genreWorks] = await Promise.all([this.workRepository.listWorks(), this.readingRepository.getProgress(), this.serverHome(), this.memberRecords(role), repo && genre ? repo.search({ q: genre, f: 'genre', sort: 'like' }) : null])
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
    // 실시간 인기·급상승은 한 화면 블록이라 둘 중 하나라도 실패하면 함께 실패로 알립니다.
    const rankingFailed = !!server && (server.top10.failed || server.rising.failed)
    return {
      works,
      forkSources,
      seen: progress.seen,
      filtered: genreWorks ?? (filter ? pub.filter((w) => filter(w, works)) : null),
      originals: origs,
      forkFeed: server ? server.forkFeed.items : pub.filter((w) => w.parent).sort(sorter('new')),
      continueReading: resume ?? null,
      top10: server ? server.top10.items : pub.slice().sort(sorter('pop')).slice(0, 10),
      rising: server ? server.rising.items : origs.slice().sort(sorter('view')),
      rankingFailed,
      forkFeedFailed: !!server?.forkFeed.failed,
      freshFailed: !!server?.fresh.failed,
      weeklyFailed: !!server?.weekly.failed,
      /** 서버가 실시간 인기를 계산한 시각(화면의 "HH:mm 기준"). 목업이거나 실시간 인기·급상승이 하나라도 실패하면 실패 안내 위에 남기지 않도록 null */
      rankingComputedAt: rankingFailed ? null : server?.top10.computedAt ?? null,
      /** 순위·업데이트·인기 줄을 서버 기간별 랭킹으로 채웠는가(목업은 메모리 데모) */
      serverRanking: !!server,
      /** 순위 섹션이 실제 순위인가: 서버 랭킹이거나 좋아요·조회 지표가 있는 목업. 지표 없는 서버 작품의 단순 목록이면 false입니다. */
      ranked: !!server || !pub.some((w) => w.statisticsSupported === false),
      fresh: server ? server.fresh.items : pub.slice().sort(sorter('new')).slice(0, 5),
      picks: pub.slice(0, 6),
      /** 오늘의 발견: 랭킹·최신과 겹치지 않게 오래된 작품부터. 서버 작품은 갱신 시각이 없어 공개 목록(생성 최신순)을 뒤집습니다. */
      discover: (pub.some((w) => w.statisticsSupported === false) ? pub.slice() : pub.slice().sort(sorter('new'))).reverse(),
      weekly: server ? server.weekly.items : origs.slice(0, 4),
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

  /**
   * 소설 상세 회차 목록의 누적 조회 수(공개 상세 응답에서만 옴). 공개 서버 작품이 아니거나 검색 저장소가 없는 목업이면 요청 없이 undefined이고,
   * 읽지 못하면 0회로 숨기지 않고 던지므로 화면이 수를 감춘다.
   */
  async episodeViews(work: Work, signal?: AbortSignal) {
    return work.canonical && isPub(work) ? this.workSearchRepository?.episodeViews(work.id, signal) : undefined
  }

  private async load(id: string) {
    const [works, worlds, progress] = await Promise.all([this.workRepository.listWorks(), this.workRepository.listWorlds(), this.readingRepository.getProgress()])
    return { works, worlds, progress, w: works.find((x) => x.id === id || x.slug === id) }
  }

  /**
   * 좋아요 수와 내 좋아요 여부. 서버 작품(canonical)은 목록의 공개 수를 쓰되, 내 여부는 로그인 회원만 서버에 묻습니다.
   * 익명·공개가 아니라는 답(null: 소유자가 여는 비공개·운영 제한 작품)·만료된 세션은 안 누른 상태로 열고 그 밖의 조회 실패는 던집니다.
   * 데모 작품은 메모리 진행 기록이며 시드 수에 내 좋아요 1을 더합니다.
   */
  private async likeStateOf(work: Pick<Work, 'id' | 'likes' | 'canonical'>, role: Role, memoryLiked: boolean): Promise<WorkLikeState> {
    const repo = this.workLikeRepository
    if (!repo || !work.canonical) return { likes: work.likes + (memoryLiked ? 1 : 0), liked: memoryLiked }
    const unliked = { likes: work.likes, liked: false }
    if (!role) return unliked
    const read = await repo.read(work.id).catch((error: unknown) => { if (error instanceof SessionExpired) return null; throw error })
    return read ?? unliked
  }

  /**
   * 목업 work(): 볼 수 없는 작품이면 null (unavailableWork). 공개 설정(wiki)은 [upto]회차(1~마지막 회차로 맞춤) 기준이고,
   * 없으면 최신 회차 기준이다. 맞춘 기준 회차는 upto로 돌려준다.
   */
  async getWork(id: string, role: Role, upto?: number) {
    const { works, worlds, progress, w: loaded } = await this.load(id)
    if (!canView(loaded, role)) return null
    const last = epsOf(loaded).length
    const n = upto && upto >= 1 ? Math.min(Math.floor(upto), last) : last
    const [w, records] = await Promise.all([this.workRepository.readWorld(loaded, n), this.memberRecords(role)])
    const record = records.find((r) => r.workId === w.id)
    const forks = forksOf(works, w.id)
    const like = await this.likeStateOf(w, role, !!progress.liked[w.id])
    return {
      work: w,
      upto: n,
      parent: works.find((x) => x.id === w.parent),
      visible: epsOf(w).map((e, i) => [e, i] as const).filter(([e]) => visibleEpisode(w, e, role)),
      last: record?.lastEpisode,
      read: record?.readEpisodes ?? [],
      liked: like.liked,
      /** 화면에 보일 좋아요 수(서버 작품은 서버 값, 데모 작품은 시드 수 + 내 좋아요) */
      likes: like.likes,
      forks,
      forkList: forkList(w, worlds),
      topForks: forks.slice().sort(sorter('pop')),
    }
  }

  /**
   * U45 설정 위키: 서버 작품에 연결된 세계관(DEC-46)이 있으면 [upto]회차(없으면 발행된 최대 회차)까지 독자에게 공개된 그 세계관의 설정 카드를 돌려줍니다.
   * 연결된 세계관이 없거나 메모리 데모 작품이면 null이고 화면은 기존 작품 설정 위키(getWork의 wiki)를 씁니다. 읽기 실패는 null로 바꾸지 않고 던집니다.
   */
  async linkedWorldCards(work: Pick<Work, 'id' | 'canonical'>, upto?: number) {
    if (!work.canonical) return null
    const cards = await this.workRepository.readWorldCards?.(work.id, upto && upto >= 1 ? Math.floor(upto) : undefined)
    return cards?.worldId ? cards : null
  }

  /**
   * 이 작품에서 갈라진 공개 포크 수를 분기 기준 회차별로 셉니다(0편인 회차는 키가 없음). 소설 상세의 회차별 포크 수와 같은 목록(forksOf)을 쓰며,
   * 작품 목록을 읽지 못하면 0편으로 채우지 않고 던집니다(작품 관리 화면은 그때 수를 감춥니다).
   * ponytail: 공개 작품 전체 목록을 읽어 센다(소설 상세도 같은 목록). 작품이 많아지면 작품별 포크 수를 주는 API로 바꾼다.
   */
  async forkCountsByEpisode(id: string) {
    const counts: Record<number, number> = {}
    for (const { forkAt } of forksOf(await this.workRepository.listWorks(), id)) if (forkAt) counts[forkAt] = (counts[forkAt] ?? 0) + 1
    return counts
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
    const n = loaded.canonical ? at : Math.max(1, Math.min(+at || 1, eps.length))
    if (!eps[n-1] || !visibleEpisode(loaded,eps[n-1],role)) return 'hidden' as const
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
      // paragraphs: 고를 수 있는 문장(문단별), blocks: 화면이 그릴 블록. 문장 순서가 서로 같다.
      ...readerBody(ep.p),
      previous: shown.filter((i) => i < n).at(-1) ?? null,
      next: shown.find((i) => i > n) ?? null,
      forks: w.parent ? [] : forksOf(works, id).filter((f) => f.forkAt === n),
      canFork: forkOK(w, n, worlds),
      recording,
    }
  }

  /**
   * 좋아요를 토글해 새 상태(true: 눌림)를 돌려줍니다. 화면이 보여 준 상태(`shown`)가 서버 작품이면 그 반대를 Content에 보내
   * 서버가 확정한 상태를 돌려주고 실패는 던집니다(성공으로 숨기지 않음). 그 밖의 데모 작품은 메모리 진행 기록을 뒤집습니다.
   */
  async toggleLike(id: string, shown?: { canonical?: boolean; liked: boolean }) {
    const repo = this.workLikeRepository
    if (repo && shown?.canonical) return (await (shown.liked ? repo.unlike(id) : repo.like(id))).liked
    const progress = await this.readingRepository.getProgress()
    progress.liked[id] = !progress.liked[id]
    await this.readingRepository.saveProgress(progress)
    return progress.liked[id]
  }

  /**
   * 목업 searchPage(): 서버 저장소가 있으면 검색은 서버가 하고 page(0부터) 한 장(20개)만 받습니다. hasMore(더 받을 수 있음)는
   * 서버 개수가 한 장을 가득 채웠는지로 봅니다(페이지를 무시하고 전부 주는 서버의 21개 이상은 마지막으로 봅니다).
   * 메모리 데모는 전부 돌려주므로 더 보기가 없습니다. 랭킹 화면은 페이지 없이 rankWorks를 씁니다.
   */
  async findWorks({ q = '', f = 'all', sort, page = 0 }: { q?: string; f?: SearchField; sort: SearchSort; page?: number }, signal?: AbortSignal) {
    if (this.workSearchRepository) {
      const found = await this.workSearchRepository.search({ q: q.trim(), f, sort, page, size: SEARCH_PAGE_SIZE }, signal)
      return { list: found, hasMore: found.length === SEARCH_PAGE_SIZE }
    }
    const works = await this.workRepository.listWorks()
    return {
      list: works.filter(isPub).filter((w) => matchW(w, q, f, works)).sort(sorter(sort === 'latest' ? 'new' : sort)),
      hasMore: false,
    }
  }

  /**
   * 소설 상세 추천(새 서버 경로 없이 공개 검색 findWorks를 인기 순으로 두 번 부른다): 같은 작가의 다른 작품(f=author)과 첫 장르의 비슷한 작품(f=genre,
   * 해시태그가 겹치는 순)을 병렬로 읽는다. 한쪽만 실패할 수 있어 실패는 빈 목록으로 숨기지 않고 섹션마다 failed로 알리며, 이 메서드는 던지지 않는다.
   * ponytail: 검색 첫 장(20개) 안에서만 거른다. 같은 작가·장르 작품이 20개를 넘으면 뒤의 작품은 못 찾는다. 필요하면 서버에 추천 API를 둔다.
   */
  async recommendWorks(work: Work, signal?: AbortSignal) {
    const genre = work.genre.split(' · ')[0]
    const [byAuthor, byGenre] = await Promise.allSettled([
      this.findWorks({ q: work.author, f: 'author', sort: 'like' }, signal),
      genre ? this.findWorks({ q: genre, f: 'genre', sort: 'like' }, signal) : { list: [] as Work[] },
    ])
    const sameAuthor = byAuthor.status === 'fulfilled' ? sameAuthorWorks(work, byAuthor.value.list) : []
    return {
      sameAuthor: { items: sameAuthor, failed: byAuthor.status === 'rejected' },
      similar: { items: byGenre.status === 'fulfilled' ? similarWorks(work, byGenre.value.list, sameAuthor) : [], failed: byGenre.status === 'rejected' },
    }
  }

  /**
   * /rank: t는 범위 탭(all·orig·if)이다. 서버 저장소가 있으면 서버 기간별 랭킹(기능표 45, 최대 50개)을 묻고(최신·방금 업데이트는 기간을 쓰지 않아 보내지 않음),
   * 목업이면 메모리 정렬(조회·급상승=조회 수, 인기=좋아요, 최신·방금 업데이트=갱신 순)이며 기간·계산 시각이 없다.
   */
  async rankWorks({ t = 'all', kind, period }: { t?: string; kind: RankingKind; period: RankingPeriod }): Promise<{ items: Work[]; computedAt: Date | null }> {
    const repo = this.workSearchRepository
    if (repo) return repo.rankings({ kind, ...(rankingUsesPeriod(kind) ? { period } : {}), type: RANKING_TYPES.find(([tab]) => tab === t)?.[2] ?? 'all', limit: 50 })
    const sort = { view: 'view', rising: 'view', popular: 'pop', latest: 'new', updated: 'new' }[kind]
    return { items: (await this.workRepository.listWorks()).filter(isPub).filter(inTab(t)).sort(sorter(sort)), computedAt: null }
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

import type { Doc, Wiki } from './wiki'
import type { World } from './world'

export type Theme = 'hanji' | 'star' | 'neon'

export type Knowledge = { text: string; knownAt: number; publicAt?: number }
export type CastMember = { n: string; c: string; d: string; st: string; knowledge?: Knowledge[] }
/** views: 회차 누적 회원 조회 수. 서버가 주지 않으면 없다. */
export type Episode = { t: string; p: string[]; versionId?: string; views?: number; hidden?: boolean; note?: string; authorNote?: string; ai?: boolean }
/** 목업 autoOf(w): AI 자율 연재 데모 상태 */
export type AutoSerial = { on: boolean; status: string; react: boolean; requireReview: boolean; log: string[]; failures?: number }
/** [회차, 종류(m 주요·f 복선·s 설정), 내용, 관련 인물] */
export type StoryEvent = [number, string, string, string[]]
export type WikiDoc = Doc

export type Snapshot = {
  eps: Episode[]
  rules: string[]
  cast: CastMember[]
  events: StoryEvent[]
  takenAt: number
  srcHash: string
}

export type Work = {
  id: string
  title: string
  slug?: string
  canonical?: boolean
  hanja?: string
  theme: Theme
  genre: string
  author: string
  owner?: string
  kind: string
  rights: string
  by: string
  tags: string[]
  hash?: string[]
  likes: number
  views: number
  cmts: number
  /** 마지막 업데이트 후 지난 분 */
  upd: number
  /**
   * false면 서버가 댓글 수·갱신 시각을 주지 않는 작품이라 cmts·upd는 자리표시 값이다. 화면은 이 둘을 표시하지 않고 카드·목록의 좋아요도
   * 이 표시 묶음에 두어 감춘다(소유자 응답의 likes는 0). 소설 상세만 서버 작품의 좋아요 수를 서버에서 읽어 직접 보여 준다. 생략하면 모두 표시한다.
   * 예외로 방금 업데이트 랭킹(rankings kind=updated)의 작품은 upd가 서버 값(마지막 발행 후 지난 분)이라 그 순위 화면이 upd만,
   * 인기 순 랭킹(kind=popular)은 likes가 서버 값이라 그 순위 화면이 ♥만 보인다.
   */
  statisticsSupported?: boolean
  hero?: [string, string]
  heroBg?: string
  lite?: boolean
  hook?: string
  summary?: string
  dir?: string
  coverImg?: string | null
  private?: boolean
  hidden?: boolean
  mine?: boolean
  rating?: string
  schedule?: string[]
  /** 연재 상태. 서버에 없어 데모 작품에만 있고(표시 전용) 서버 작품은 비어 있다. */
  serial?: '연재 중' | '완결' | '휴재'
  forkFrom?: number
  forksAllowed?: boolean
  forkAll?: boolean
  forkEps?: number[]
  cast: CastMember[]
  rules: string[]
  ruleFrom?: Record<string, number>
  castFrom?: Record<string, number>
  eventFrom?: Record<string, number>
  events: StoryEvent[]
  ownEvents?: StoryEvent[]
  eps: Episode[]
  worldIds?: string[]
  localRules?: string[]
  wiki?: Wiki
  parent?: string
  /** 원작 제목. 원작이 삭제·비공개라 공개 목록에 없어도 Fork 응답의 source.title로 보여 준다. */
  parentTitle?: string
  /** 원작이 소프트 삭제됐는지(DEC-42). 독자에게는 분기 전 회차 본문이 비어 온다. */
  parentDeleted?: boolean
  forkAt?: number
  snap?: Snapshot
  removedWorldDocs?: Record<string, WikiDoc[]>
  auto?: AutoSerial
  memo?: string
  synopsis?: string
  /** 서술 순서 (사건 제목) */
  narrativeOrder?: string[]
  settings?: { autoWorld: boolean; typoAuto: boolean }
  /** 목업 worldCandidate: 설정 추출 후 검토 대기 후보 */
  worldCandidate?: { text: string; source: string; ep: number }
}

export type Role = 'user' | 'admin' | null

/** 목업 orig(): 원작 기본값(포크 허용 회차)을 채웁니다. */
export function original(o: Work): Work {
  const w = { ...o, forksAllowed: (o.forkFrom ?? 0) > 0, forkAll: !!o.forkAll }
  if (o.forkEps == null) {
    w.forkEps = (o.forkFrom ?? 0) > 0
      ? o.eps.map((_, i) => i + 1).filter((n) => n >= (o.forkFrom ?? 0))
      : []
  }
  return w
}

/** 목업 nid(): 데모용 새 ID */
export const nid = (prefix: string) => prefix + crypto.randomUUID().slice(0, 8)

export const hashText = (s: string) => {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** 회차별 포크 허용: forkAll(전체 회차) 또는 forkEps(허용한 회차 번호 목록) */
export function forkList(w: Work | undefined, worlds: World[]): number[] {
  if (!w || w.parent || w.private || w.hidden || !w.forksAllowed) return []
  if (w.worldIds && !w.worldIds.every((id) => worlds.some((world) => world.id === id && world.public))) return []
  const list = w.forkAll
    ? w.eps.map((_, i) => i + 1)
    : (w.forkEps ?? []).filter((n) => n <= w.eps.length).sort((a, b) => a - b)
  return list.filter((n) => w.canonical ? !w.eps[n - 1]?.hidden : !w.eps.slice(0, n).some((e) => e.hidden))
}

export const forkOK = (w: Work | undefined, n: number, worlds: World[]) => forkList(w, worlds).includes(+n)

export function forkLabel(w: Work, worlds: World[]) {
  const list = forkList(w, worlds)
  if (!list.length) return '포크 비허용'
  return w.forkAll ? '전체 회차 포크 허용' : list.join('·') + '화 포크 허용'
}

export const isPub = (w: Work) => !w.hidden && !w.private && (w.parent ? w.eps.length > 0 : true)
/** 원작이 삭제된 Fork에서 독자에게 본문이 숨겨져 온 분기 전 회차인지(DEC-42). 소유자는 본문을 받으므로 해당하지 않는다. */
export const hiddenSourceEpisode = (w: Pick<Work, 'parent' | 'forkAt' | 'parentDeleted'>, n: number, paragraphs: string[]) =>
  !!w.parent && !!w.parentDeleted && n <= (w.forkAt ?? 0) && !paragraphs.join('').trim()
export const epsOf = (w: Work) => (w.parent && w.snap ? w.snap.eps.concat(w.eps) : w.eps)
/** 설정(규칙·인물·사건) 출처: 포크는 자기 스냅샷만 본다 */
export const baseOf = (w: Work): Pick<Snapshot, 'rules' | 'cast' | 'events'> => (w.parent && w.snap ? w.snap : w)
export const isMine = (w: Work) => w.mine ?? (w.owner === 'me' || w.author === '나')
export const canView = (w: Work | undefined, role: Role): w is Work => !!w && (isPub(w) || (role === 'user' && isMine(w)))
/** 신고 버튼 노출(#172): 공개 작품이고 본인 작품이 아닐 때. 검색 카드의 서버 작품은 mine을 모르므로 소유자 회원 ID로도 가른다. 로그인·접수 권한은 서버가 검사한다(비로그인은 접수 때 로그인 안내). */
export const canReport = (w: Work, memberId: string | null) => isPub(w) && !isMine(w) && (memberId === null || w.owner !== memberId)
export const visibleEpisode = (w: Work, e: Episode, role: Role) => !e.hidden || (!w.canonical && role === 'user' && isMine(w))
export const originals = (works: Work[]) => works.filter((w) => !w.parent && !w.private)
/** 목업 분류 필터(관리자·캐릭터챗 목록): 전체·원작·포크 */
export const ofKind = (kind: string, w: { parent?: string }) => kind === 'all' || (kind === 'fork' ? !!w.parent : !w.parent)
export const forksOf = (works: Work[], id: string) => works.filter((w) => w.parent === id && isPub(w))

export const firstEp = (w: Pick<Work, 'events'>, name: string) => {
  const e = w.events.filter((x) => x[3].includes(name)).map((x) => x[0])
  return e.length ? Math.min(...e) : 1
}

export function publicCast(w: Work, ep: number) {
  const cast = w.parent ? w.snap?.cast : w.cast
  return (cast ?? []).filter((c) => w.parent || ((!w.castFrom || w.castFrom[c.n] <= ep) && firstEp(w, c.n) <= ep))
}

/** 목업 makeFork(): 분기 시점까지 독자에게 공개된 항목만 깊은 복사해 원작과 분리합니다. */
export function makeFork(p: Work, at: number, o: Partial<Work> & { id: string; title: string; author: string }, now = Date.now()): Work {
  const noHistory = !p.worldIds && !p.ruleFrom
  const fe = (n: string) => {
    const e = p.events.filter((x) => x[3].includes(n)).map((x) => x[0])
    return e.length ? Math.min(...e) : 1
  }
  const snap: Snapshot = structuredClone({
    eps: p.eps.slice(0, at),
    rules: p.rules.filter((r) => !(p.ruleFrom && p.ruleFrom[r] > at)),
    cast: p.cast
      .filter((c) => (noHistory || fe(c.n) <= at) && (!p.castFrom || p.castFrom[c.n] <= at))
      .map((c) => {
        const doc = p.wiki?.docs.find((d) => d.cat === 'char' && d.t === c.n)
        return { ...c, knowledge: (doc?.knowledge ?? []).filter((k) => k.knownAt <= at && k.publicAt && k.publicAt <= at) }
      }),
    events: p.events.concat(p.ownEvents ?? []).filter((e) => (noHistory || e[0] <= at) && (!p.eventFrom || p.eventFrom[e[2]] <= at)),
    takenAt: now,
    srcHash: hashText(JSON.stringify(p.eps.slice(0, at))),
  })
  const f: Work = {
    parent: p.id, forkAt: at, theme: p.theme, genre: p.genre + ' · 포크', kind: '포크', rights: '원작 따름',
    tags: ['if'], likes: 0, views: 0, cmts: 0, upd: 0, eps: [], ownEvents: [], snap,
    cast: [], rules: [], events: [], by: '',
    ...o,
  }
  f.by = '포크 · 원작 「' + p.title + '」 ' + at + '화에서 포크 · ' + f.author
  return f
}

/** 목업 AV: 인물·작성자 아바타 색 */
export const AVATAR_COLORS = ['#B48A5A','#6F93C9','#5FA89A','#B07A9A','#8E7CC3','#C9A04A']
export const avatarOf = (s: string) => AVATAR_COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]

/** 목업 tagsOf(): 포크는 원작의 해시태그를 이어받습니다. */
export const tagsOf = (w: Work, works: Work[]) => w.hash?.length ? w.hash : (w.parent && works.find((x) => x.id === w.parent)?.hash) || []

/** 소설 상세 추천 한 목록의 최대 개수 */
const RECOMMEND_MAX = 6
/** 탈퇴한 회원의 작가명 자리표시(서버가 채움). 탈퇴 회원은 모두 같은 이름이라 같은 작가라고 볼 수 없다. */
const WITHDRAWN_AUTHOR = '탈퇴한 회원'

/** 같은 작가의 다른 작품. 작가 검색(f=author)은 부분 일치라 작가명이 정확히 같은 작품만 남기고 현재 작품은 빼며, 검색의 인기 순을 유지해 최대 6개다. */
export const sameAuthorWorks = (current: Work, found: Work[]) =>
  current.author === WITHDRAWN_AUTHOR ? [] : found.filter((w) => w.id !== current.id && w.author === current.author).slice(0, RECOMMEND_MAX)

/**
 * 비슷한 작품. 현재 작품과 [exclude](같은 작가 목록)에 든 작품은 빼고, 오른쪽 포크 박스가 이미 보여 주는 현재 작품의 포크·원작·같은 원작의 형제 포크도 뺀다.
 * 남은 것을 해시태그가 많이 겹치는 순(동점은 검색의 인기 순 그대로)으로 최대 6개다.
 */
export function similarWorks(current: Work, found: Work[], exclude: Work[] = []) {
  const skip = new Set([current.id, ...exclude.map((w) => w.id)])
  const tags = new Set(current.hash)
  const overlap = (w: Work) => (w.hash ?? []).filter((h) => tags.has(h)).length
  const related = (w: Work) => w.parent === current.id || (!!current.parent && (w.id === current.parent || w.parent === current.parent))
  return found.filter((w) => !skip.has(w.id) && !related(w)).sort((a, b) => overlap(b) - overlap(a)).slice(0, RECOMMEND_MAX)
}

/** 목업 SORTS: /ifs 포크 모음·캐릭터챗 목록 정렬. 검색은 서버 계약인 SEARCH_SORTS, 랭킹은 RANKING_KINDS를 씁니다. */
export const SORTS = [['new', '최신 순'], ['pop', '인기 순'], ['view', '조회 순']] as const
const SERVER_SORTS = [['title', '제목 순'], ['author', '작가 순']] as const
/** 서버 작품(statisticsSupported:false)은 좋아요·갱신 시각이 없어 만들 수 없는 지표 대신 제목·작가 순만 고르게 합니다. */
export const sortsOf = (works: Pick<Work, 'statisticsSupported'>[]): readonly (readonly [string, string])[] =>
  works.some((w) => w.statisticsSupported === false) ? SERVER_SORTS : SORTS

/** 작품 검색 계약(docs/design/work-search-ranking-contract.md)의 범위·정렬(/search). 인기 순(like)은 공개 좋아요 수 순입니다. */
export const SEARCH_FIELDS = [['all', '전체'], ['title', '제목'], ['author', '작가'], ['tag', '태그'], ['genre', '장르']] as const
export const SEARCH_SORTS = [['latest', '최신 순'], ['like', '인기 순'], ['view', '조회 순']] as const
export type SearchField = (typeof SEARCH_FIELDS)[number][0]
export type SearchSort = (typeof SEARCH_SORTS)[number][0]

/**
 * 기간별 랭킹(기능표 45)의 범위 탭·기준·기간으로, /rank 주소 쿼리 t·kind·period가 받는 값이다. 항목은 [값, 라벨, …]이며
 * 범위 탭의 끝은 서버 type, 기간의 끝은 집계 구간 문구다. 최신·방금 업데이트는 기간을 쓰지 않는다.
 */
export const RANKING_TYPES = [['all', '전체', 'all'], ['orig', '원작 소설', 'original'], ['if', '포크 소설', 'fork']] as const
export const RANKING_KINDS = [['view', '조회 순'], ['popular', '인기 순'], ['rising', '급상승'], ['latest', '최신 순'], ['updated', '방금 업데이트']] as const
export const RANKING_PERIODS = [['day', '일간', '최근 24시간'], ['week', '주간', '최근 7일'], ['month', '월간', '최근 30일']] as const
export type RankingType = (typeof RANKING_TYPES)[number][2]
export type RankingKind = (typeof RANKING_KINDS)[number][0]
export type RankingPeriod = (typeof RANKING_PERIODS)[number][0]
export const rankingUsesPeriod = (kind: RankingKind) => kind !== 'latest' && kind !== 'updated'

/** 목업 matchW(): 범위가 장르일 때만 장르를 검색하고, 전체 범위는 제목·작가·태그만 봅니다. */
export function matchW(w: Work, q: string, f: string, works: Work[]) {
  if (!q) return true
  q = q.replace(/^#/, '').toLowerCase()
  const t = w.title.toLowerCase().includes(q)
  const au = String(w.author).toLowerCase().includes(q)
  const tg = tagsOf(w, works).some((h) => h.slice(1).toLowerCase().includes(q))
  const g = w.genre.toLowerCase().includes(q)
  return f === 'title' ? t : f === 'author' ? au : f === 'tag' ? tg : f === 'genre' ? g : t || au || tg
}

export const sorter = (k: string) => (a: Work,b: Work) => {
  if(k==='author') return a.author.localeCompare(b.author,'ko') || a.title.localeCompare(b.title,'ko')
  if(k==='title' || a.statisticsSupported===false || b.statisticsSupported===false) return a.title.localeCompare(b.title,'ko')
  return k==='new' ? a.upd-b.upd : k==='pop' || k==='like' ? b.likes-a.likes : b.views-a.views
}

import type { World } from './world'

export type Theme = 'hanji' | 'star' | 'neon'

export type Knowledge = { text: string; knownAt: number; publicAt?: number }
export type CastMember = { n: string; c: string; d: string; st: string; knowledge?: Knowledge[] }
export type Episode = { t: string; p: string[]; hidden?: boolean; note?: string; authorNote?: string; ai?: boolean }
/** 목업 autoOf(w): AI 자율 연재 데모 상태 */
export type AutoSerial = { on: boolean; status: string; react: boolean; requireReview: boolean; log: string[]; failures?: number }
/** [회차, 종류(m 주요·f 복선·s 설정), 내용, 관련 인물] */
export type StoryEvent = [number, string, string, string[]]
export type WikiDoc = { id: string; cat: string; t: string; knowledge?: Knowledge[] } & Record<string, unknown>

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
  wiki?: { docs: WikiDoc[] } & Record<string, unknown>
  parent?: string
  forkAt?: number
  snap?: Snapshot
  removedWorldDocs?: Record<string, WikiDoc[]>
  auto?: AutoSerial
  memo?: string
  synopsis?: string
  /** 서술 순서 (사건 제목) */
  narrativeOrder?: string[]
  settings?: { autoWorld: boolean; typoAuto: boolean }
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
  return list.filter((n) => !w.eps.slice(0, n).some((e) => e.hidden))
}

export const forkOK = (w: Work | undefined, n: number, worlds: World[]) => forkList(w, worlds).includes(+n)

export function forkLabel(w: Work, worlds: World[]) {
  const list = forkList(w, worlds)
  if (!list.length) return '포크 비허용'
  return w.forkAll ? '전체 회차 포크 허용' : list.join('·') + '화 포크 허용'
}

export const isPub = (w: Work) => !w.hidden && !w.private && (w.parent ? w.eps.length > 0 : true)
export const epsOf = (w: Work) => (w.parent && w.snap ? w.snap.eps.concat(w.eps) : w.eps)
/** 설정(규칙·인물·사건) 출처: 포크는 자기 스냅샷만 본다 */
export const baseOf = (w: Work): Pick<Snapshot, 'rules' | 'cast' | 'events'> => (w.parent && w.snap ? w.snap : w)
export const isMine = (w: Work) => w.owner === 'me' || w.author === '나'
export const canView = (w: Work | undefined, role: Role): w is Work => !!w && (isPub(w) || (role === 'user' && isMine(w)))
export const visibleEpisode = (w: Work, e: Episode, role: Role) => !e.hidden || (role === 'user' && isMine(w))
export const originals = (works: Work[]) => works.filter((w) => !w.parent && !w.private)
/** 목업 분류 필터(관리자·캐릭터 챗 목록): 전체·원작·포크 */
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

/** 목업 FIELDS·SORTS: 검색 범위와 정렬 */
export const FIELDS = [['all', '전체'], ['title', '제목'], ['author', '작가'], ['tag', '태그']] as const
export const SORTS = [['new', '최신 순'], ['pop', '인기 순'], ['view', '조회 순']] as const

/** 목업 matchW(): 장르는 검색하지 않습니다. */
export function matchW(w: Work, q: string, f: string, works: Work[]) {
  if (!q) return true
  q = q.replace(/^#/, '').toLowerCase()
  const t = w.title.toLowerCase().includes(q)
  const au = String(w.author).toLowerCase().includes(q)
  const tg = tagsOf(w, works).some((h) => h.slice(1).toLowerCase().includes(q))
  return f === 'title' ? t : f === 'author' ? au : f === 'tag' ? tg : t || au || tg
}

export const sorter = (k: string) => k === 'new'
  ? (a: Work, b: Work) => (a.upd || 0) - (b.upd || 0)
  : k === 'pop' ? (a: Work, b: Work) => (b.likes || 0) - (a.likes || 0) : (a: Work, b: Work) => (b.views || 0) - (a.views || 0)

import { baseOf, type Knowledge, type Work } from './work'

/** 목업 WCATS·LINE: 사전 분류와 사건 라인 */
export type WikiCat = { id: string; n: string; c: string; lock?: number }
export const WCATS: WikiCat[] = [{ id: 'char', n: '캐릭터', c: '#7FBFA9', lock: 1 }, { id: 'event', n: '사건', c: '#EE9A75', lock: 1 }, { id: 'place', n: '장소', c: '#3F6B57' }, { id: 'org', n: '세력·조직', c: '#D9617D' }, { id: 'item', n: '아이템', c: '#D8A93B' }, { id: 'world', n: '세계관 설정', c: '#9C8CE0' }]
export const LINE: Record<string, string> = { m: '메인', s: '서브', f: '복선' }

const SEEDP: Record<string, [Record<string, string>, Record<number, Record<string, string>>]> = { '성진': [{ 나이: '20', 성별: '남', 소속: '연화봉 도량', 성격: '성실하지만 마음이 쉽게 흔들림', 말투: '공손한 존댓말', 관계: '육관대사의 제자' }, { 1: { 상태: '계율을 어기고 술을 마심' }, 2: { 상태: '마음이 흔들림' }, 3: { 상태: '벌을 받아 인간 세상으로' } }],
  '육관대사': [{ 성별: '남', 소속: '연화봉 도량', 성격: '엄격하고 깊이 내다봄', 말투: '-느니라 체', 관계: '성진의 스승' }, {}],
  '팔선녀': [{ 소속: '남악 위부인', 성격: '장난스럽고 호기심 많음', 말투: '-지요 체', 관계: '성진에게서 구슬을 받음' }, {}],
  '양소유': [{ 성별: '남', 소속: '회남 수주현 양 처사 댁', 관계: '성진의 환생' }, {}],
  '리안': [{ 소속: '견습 서약사', 성격: '끈질기고 확신이 강함', 말투: '존댓말', 관계: '오르벤의 제자' }, { 2: { 상태: '봉인의 속삭임을 들음' } }],
  '카엘': [{ 소속: '별빛 탑 기사', 성격: '원칙을 지킴', 말투: '-오 체', 관계: '리안을 경계하다 서고 열람을 허락' }, {}],
  '세라핀': [{ 소속: '재의 왕국 사절단', 성격: '여유롭고 속을 알 수 없음', 말투: '반말', 관계: '리안에게 손을 내밂' }, {}],
  '도윤': [{ 나이: '17', 소속: '배달부', 성격: '묵묵하고 집요함', 관계: '하람과 편지로 엮임' }, {}],
  '하람': [{ 소속: '7구역', 관계: '편지의 글씨가 어머니 것이라고 말함' }, {}],
  '길동': [{ 성별: '남', 소속: '홍 판서 댁', 성격: '총명함', 관계: '홍 판서의 서자' }, {}],
  '홍 판서': [{ 성별: '남', 관계: '길동의 아버지' }, {}] }
const SEEDW: Record<string, [string, string, string, number][]> = { guunmong: [['place', '연화봉', '남악 형산의 봉우리. 육관대사의 도량이 있다.', 1], ['place', '동정호 용궁', '성진이 심부름을 간 용왕의 궁.', 1], ['place', '돌다리', '성진이 팔선녀를 만난 좁은 다리.', 2], ['item', '여덟 구슬', '성진이 던진 복숭아꽃이 변한 구슬.', 2], ['org', '연화봉 도량', '육관대사와 제자들이 수행하는 곳.', 1]],
  starlight: [['place', '별빛 탑', '봉인을 지키는 탑. 해가 지면 문이 닫힌다.', 1], ['place', '지하서고', '봉인 문양이 있는 가장 깊은 서고.', 2], ['item', '별빛 수정', '탑 꼭대기에서 깜빡이는 수정.', 1], ['item', '오르벤의 서한', '오르벤이 남긴 낡은 서한.', 1], ['org', '재의 왕국 사절단', '붉은 망토의 세라핀이 이끈다.', 3]],
  postman: [['place', '고가도로', '도윤이 배달하는 길.', 1], ['place', '7구역 배급소', '하람이 기다리던 곳.', 2], ['item', '주소가 지워진 편지', '봉투에 ‘집’ 한 단어만 적힌 편지.', 1]],
  hong: [['place', '홍 판서 댁', '길동이 태어나 자란 집.', 1]] }
const SEEDL: Record<string, [string, string, string][]> = { guunmong: [['돌다리에서 팔선녀를 만나다', '스승의 벌로 인간 세상으로', '계기'], ['복숭아꽃이 여덟 구슬이 되다', '스승의 벌로 인간 세상으로', '복선']], starlight: [['탑 앞에서 밤을 지새우다', '봉인 아래의 속삭임', '계기']] }

export type Doc = { id: string; cat: string; t: string; alias: string[]; tags: string[]; props: Record<string, string>; at: Record<number, Record<string, string>>; img?: string | null; body: string; knowledge?: Knowledge[]; ep?: number; line?: string; who?: string[]; links?: { to: string; k: string }[] }
export type Wiki = { docs: Doc[]; cats: WikiCat[]; synopsis: string }

/**
 * 목업 wikiOf(w): 처음 열 때 작품 설정(포크는 스냅샷)에서 사전을 한 번 만들어 w.wiki에 두고, 이후에는 저장본을 씁니다.
 * 사건은 보드(events·ownEvents)에 새로 생긴 것만 문서로 덧붙여요.
 */
export function wikiState(w: Work): Wiki {
  const b = baseOf(w), src = w.parent || w.id, lim = w.parent ? w.forkAt ?? 0 : 999
  if (!w.wiki) {
    const docs: Doc[] = []
    for (const c of b.cast) {
      const [props, at] = SEEDP[c.n] ?? [{}, {}]
      docs.push({ id: 'char:' + c.n, cat: 'char', t: c.n, alias: [], tags: [], props: { 설명: c.d, ...props, 상태: c.st }, at: Object.fromEntries(Object.entries(at).filter(([k]) => +k <= lim)), img: null, body: c.d + '.', knowledge: structuredClone(c.knowledge ?? []) })
    }
    for (const r of b.rules) docs.push({ id: 'world:' + r, cat: 'world', t: r, alias: [], tags: ['규칙'], props: { 종류: '규칙', 설정검사: '사용' }, at: {}, img: null, body: r + '. 설정 검사에서 이 규칙과 어긋나는 문장을 찾아요.' })
    for (const [cat, t, body, ep] of SEEDW[src] ?? []) if (ep <= lim) docs.push({ id: cat + ':' + t, cat, t, alias: [], tags: [], props: { '첫 등장': ep + '화' }, at: {}, img: null, body })
    w.wiki = { docs, cats: structuredClone(WCATS), synopsis: '' }
  }
  const docs = w.wiki.docs
  for (const [ep, k, t, who] of b.events.concat(w.ownEvents ?? [])) {
    if (!docs.some((d) => d.cat === 'event' && d.t === t)) docs.push({ id: 'event:' + t, cat: 'event', t, alias: [], tags: ['#' + ep + '화'], props: {}, at: {}, img: null, body: '', ep, line: k, who: (who ?? []).filter(Boolean), links: [] })
  }
  for (const [a, c, k] of SEEDL[src] ?? []) {
    const A = docs.find((d) => d.cat === 'event' && d.t === a), C = docs.find((d) => d.cat === 'event' && d.t === c)
    if (A && C && !A.links!.some((l) => l.to === C.id)) A.links!.push({ to: C.id, k })
  }
  return w.wiki
}

export const wikiOf = (w: Work) => wikiState(w).docs

/** 목업 linkify(): 본문에 나온 다른 문서 제목의 첫 번째만 문서로 바꿉니다. 긴 제목을 먼저 찾아요. */
export function linkParts(docs: Doc[], text: string, selfId: string): (string | Doc)[] {
  const D = docs.filter((d) => d.id !== selfId && d.t.length >= 2).sort((a, b) => b.t.length - a.t.length)
  const src = text.replace(/@/g, '')
  if (!D.length) return [src]
  const re = new RegExp(D.map((d) => d.t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  const used = new Set<string>(), out: (string | Doc)[] = []
  let last = 0
  for (const m of src.matchAll(re)) {
    const d = D.find((x) => x.t === m[0])!
    if (used.has(d.id)) continue
    used.add(d.id)
    out.push(src.slice(last, m.index), d)
    last = m.index + m[0].length
  }
  out.push(src.slice(last))
  return out.filter((x) => x !== '')
}

/** 목업 propsAt(): ep 회차까지의 변화를 반영한 속성 */
export function propsAt(d: Doc, ep: number) {
  const p = { ...d.props }
  if (ep) Object.keys(d.at).map(Number).sort((a, b) => a - b).forEach((k) => { if (k <= ep) Object.assign(p, d.at[k]) })
  return p
}

/** 목업 checkItems(): 시점 미정 사건과 등장 사건이 없는 캐릭터 */
export function checkItems(docs: Doc[]) {
  const und = docs.filter((d) => d.cat === 'event' && !d.ep)
  const lone = docs.filter((d) => d.cat === 'char' && !docs.some((e) => e.cat === 'event' && (e.who ?? []).includes(d.t)))
  return { und, lone, n: und.length + lone.length }
}

/** 목업 mentions(): 이 문서 이름을 본문·속성·등장 인물에 쓴 문서 */
export const mentions = (docs: Doc[], d: Doc) => docs.filter((x) => x.id !== d.id && (x.body.includes(d.t) || Object.values(x.props).some((v) => v.includes(d.t)) || (x.who ?? []).includes(d.t)))

/** 목업 narrativeView(): 저장한 서술 순서 뒤에 새 사건을 붙입니다. */
export function narrativeOrder(w: Work, docs: Doc[]) {
  const events = docs.filter((d) => d.cat === 'event')
  const order = (w.narrativeOrder ?? []).filter((t) => events.some((e) => e.t === t))
  for (const e of events) if (!order.includes(e.t)) order.push(e.t)
  return order.map((t) => events.find((e) => e.t === t)!)
}

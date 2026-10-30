import { draftKey, episodeDraft, newEpisodeDraft, type Draft } from '../entities/draft'
import { wikiState, type Doc } from '../entities/wiki'
import { AVATAR_COLORS, baseOf, epsOf, forkLabel, isMine, nid, type AutoSerial, type CastMember, type Role, type Work } from '../entities/work'
import type { CreditRepository } from '../repositories/CreditRepository'
import type { FeedbackRepository } from '../repositories/FeedbackRepository'
import type { WorkRepository } from '../repositories/WorkRepository'
import { AI_FAIL_MSG, AI_SHORT_MSG, CreditUseCase } from './CreditUseCase'

const PROPOSAL_GUUNMONG = ['선방으로 돌아온 성진은 곧장 대사의 방 앞에 무릎을 꿇었다.', '“스승님, 오늘 돌다리에서 제 마음이 흔들렸습니다.”', '육관대사는 한참 말이 없다가 문을 열었다. “흔들린 것을 숨기지 않았으니, 아직 길을 잃은 것은 아니구나.”', '그날 밤 성진은 몰래 산을 내려가 장안의 저잣거리를 걸었다.']
const FIX: Record<string, string> = { '그날 밤 성진은 몰래 산을 내려가 장안의 저잣거리를 걸었다.': '그날 밤 성진은 산문 앞까지 걸어갔다가, 스승의 허락 없이는 내려갈 수 없다는 계율을 떠올리고 발길을 돌렸다.' }

/** 목업 jo(): 받침에 따라 조사를 고릅니다. */
const jo = (w: string, a: string, b: string) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c < 11172 && c % 28 ? a : b) }

/** 목업 propOf(): 고정 예시 이어쓰기 제안 (실제 AI 호출 없음) */
export function propOf(w: Work) {
  if (w.parent === 'guunmong') return PROPOSAL_GUUNMONG
  const c = baseOf(w).cast
  const a = (c[0] ?? { n: '주인공' }).n, b = (c[1] ?? c[0] ?? { n: '그' }).n
  return [`${jo(a, '은', '는')} 한동안 말없이 창밖을 바라보았다.`, `“이제는 피할 수 없어.” ${jo(a, '이', '가')} 낮게 말했다.`, `${jo(b, '은', '는')} 대답 대신 천천히 고개를 끄덕였다.`]
}

/** 목업 runCheck(): 데모가 알아보는 두 가지 규칙 위반만 찾습니다. */
function runCheck(w: Work, d: Draft) {
  const b = baseOf(w)
  const issues: NonNullable<Draft['check']>['issues'] = []
  for (const p of d.paras) {
    if (/몰래 산을 내려가|산을 내려가/.test(p) && b.rules.some((r) => /산을 내려가지/.test(r))) {
      const sent = (p.match(/[^.]*산을 내려가[^.]*\./) ?? [p])[0].trim()
      issues.push({ sent, rule: b.rules.find((r) => /산을 내려가지/.test(r))!, fix: FIX[sent] || sent.replace('몰래 산을 내려가', '산문 앞까지 갔다가 돌아와') })
    }
    const opened = p.match(/[^.]*문이 열렸[^.]*\./)
    if (/해가 진 뒤.*문이 열렸/.test(p) && opened && b.rules.some((r) => /문은 열리지/.test(r))) issues.push({ sent: opened[0].trim(), rule: b.rules[0], fix: '해가 진 뒤라 문은 열리지 않았다.' })
  }
  d.check = { issues, stale: false, at: Date.now() }
}

const SIMS_GUUNMONG: [string, string][] = [['팔선녀', '“어제 그 스님은 어디 계신가요?” 선녀들이 도량 문 앞에서 웃으며 묻는다.'], ['성진', '문 뒤에서 대답하지 못하고 염주만 굴린다.'], ['육관대사', '“만나고 싶거든 문을 열어라. 숨는 것도 마음이 흔들린 증거다.”'], ['성진', '문을 열고, 어제 받은 구슬을 돌려 달라고 정중히 청한다.'], ['팔선녀', '구슬 하나만 남기고 웃으며 구름에 오른다.']]
const genericSim = (c: CastMember[]): [string, string][] => [[c[0].n, '상황을 살피며 조심스럽게 먼저 말을 건넨다.'], [(c[1] ?? c[0]).n, '“그건 규칙에 어긋나는 일이오.” 단호하게 막아선다.'], [c[0].n, '물러서지 않고 자신이 알게 된 사실을 털어놓는다.'], [(c[1] ?? c[0]).n, '잠시 고민하다 조건을 걸고 한발 물러선다.']]

/** 목업 simSheet()의 고정 예시 대화: 구운몽 포크에서 다섯 인물이 모두 골라졌을 때만 원작 장면을 씁니다. */
export function simTurns(w: Work, picked: string[]) {
  if (w.parent === 'guunmong' && SIMS_GUUNMONG.every((t) => picked.includes(t[0]))) return SIMS_GUUNMONG
  return genericSim(baseOf(w).cast.filter((c) => picked.includes(c.n)))
}

/** 목업 autoOf(w) */
export const autoOf = (w: Work): AutoSerial => w.auto ?? { on: false, status: '꺼짐', react: true, requireReview: false, log: [] }

export type PublishSettings = { vis: '나만' | '모두'; on: boolean; all: boolean; eps: number[]; kind: string; ok: boolean }

const episodeText = (n: number, t: string, p: string[], note?: string) => `${n}화 ${t}\n\n${p.join('\n\n')}${note ? '\n\n작가의 말\n\n' + note : ''}`

/** 목업 syncRules(w): 세계관 문서 중 종류가 규칙인 것을 작품 규칙으로 다시 만듭니다. */
function syncRules(w: Work, worldRules: (id: string) => string[]) {
  const b = baseOf(w)
  b.rules = wikiState(w).docs.filter((d) => d.cat === 'world' && (d.props.종류 ?? '') === '규칙').map((d) => d.t)
  if (!w.worldIds) return
  const linked = w.worldIds.flatMap(worldRules)
  w.localRules = b.rules.filter((r) => !linked.includes(r))
  for (const r of b.rules) if (!Object.hasOwn(w.ruleFrom ??= {}, r)) w.ruleFrom[r] = Infinity
}

/** 목업 studio(): U13 집필실 원고 화면. 초안은 저장소에 두고 발행할 때만 회차 정본을 바꿉니다. */
export class StudioUseCase {
  private readonly workRepository: WorkRepository
  private readonly creditRepository: CreditRepository
  private readonly feedbackRepository: FeedbackRepository
  constructor(workRepository: WorkRepository, creditRepository: CreditRepository, feedbackRepository: FeedbackRepository) {
    this.workRepository = workRepository
    this.creditRepository = creditRepository
    this.feedbackRepository = feedbackRepository
  }

  /** 내 작품만 고치고 저장합니다. change가 문자열을 돌려주면 그대로 전달합니다. */
  private async change<T>(id: string, fn: (w: Work) => T) {
    const w = await this.work(id)
    if (!w || !isMine(w)) return null
    const r = fn(w)
    await this.workRepository.saveWork(w)
    return r
  }

  private async work(id: string) { return (await this.workRepository.listWorks()).find((w) => w.id === id) }

  private async draftOf(w: Work, episode?: number) {
    const key = draftKey(w.id, episode)
    const n = Number(episode)
    const ok = Number.isInteger(n) && n > 0 && n <= epsOf(w).length
    let d = await this.workRepository.getDraft(ok ? key : w.id)
    if (!d) {
      d = ok ? episodeDraft(w, n) : newEpisodeDraft(w)
      await this.workRepository.saveDraft(ok ? key : w.id, d)
    }
    return { key: ok ? key : w.id, draft: d }
  }

  /** 없으면 null, 내 소설이 아니면 notMine */
  async open(id: string, episode: number | undefined, role: Role) {
    const w = await this.work(id)
    if (!w) return null
    if (role !== 'user' || !isMine(w)) return { notMine: true as const, work: w }
    const before = JSON.stringify(w.wiki ?? null)
    wikiState(w)
    if (JSON.stringify(w.wiki) !== before) await this.workRepository.saveWork(w)
    const { key, draft } = await this.draftOf(w, episode)
    const current = (await this.draftOf(w)).draft
    return { work: w, eps: epsOf(w), base: baseOf(w), key, draft, current, proposal: propOf(w) }
  }

  private async update(key: string, change: (d: Draft) => void) {
    const d = await this.workRepository.getDraft(key)
    if (!d) return null
    change(d)
    await this.workRepository.saveDraft(key, d)
    return d
  }

  /** 목업 syncDraft(): 원고가 바뀌면 지난 설정 검사를 무효로 표시합니다. */
  edit(key: string, patch: Partial<Pick<Draft, 'title' | 'paras' | 'authorNote' | 'aiPrompt'>>) {
    return this.update(key, (d) => {
      if (d.locked) return
      if (patch.paras && d.check && JSON.stringify(patch.paras) !== JSON.stringify(d.paras)) d.check.stale = true
      Object.assign(d, patch)
    })
  }

  propose(key: string, prompt: string) {
    return this.update(key, (d) => { d.aiPrompt = prompt.trim() || '현재 장면을 자연스럽게 이어 써 주세요'; d.proposal = 'shown' })
  }

  async acceptProposal(id: string, key: string) {
    const w = await this.work(id)
    return w && this.update(key, (d) => { d.paras = d.paras.concat(propOf(w)); d.proposal = 'accepted'; if (d.check) d.check.stale = true })
  }

  dropProposal(key: string) { return this.update(key, (d) => { d.proposal = null }) }

  /** 어긋난 곳의 수를 돌려줍니다. */
  async check(id: string, key: string) {
    const w = await this.work(id)
    const d = w && await this.update(key, (x) => runCheck(w, x))
    return d?.check?.issues.length ?? 0
  }

  async fix(id: string, key: string, i: number) {
    const w = await this.work(id)
    return w && this.update(key, (d) => {
      const is = d.check?.issues[i]
      if (!is) return
      d.paras = d.paras.map((p) => p.includes(is.sent) ? p.replace(is.sent, is.fix) : p)
      runCheck(w, d)
    })
  }

  ignore(key: string, i: number) { return this.update(key, (d) => { d.check?.issues.splice(i, 1) }) }

  /** 목업 doPub: 새 회차 발행 또는 발행 회차 수정 발행 */
  async publish(id: string, key: string, title: string): Promise<{ error: string } | { ok: string; go: string }> {
    const w = await this.work(id)
    const d = await this.workRepository.getDraft(key)
    if (!w || !d || !isMine(w)) return { error: '현재 이 회차는 공개할 수 없어요' }
    if (d.locked) return { error: '원작 스냅샷은 수정 공개할 수 없어요' }
    if (w.hidden) return { error: '권리 제한 중인 작품은 발행할 수 없어요' }
    if (!d.paras.length) return { error: '소설을 먼저 써 주세요' }
    const t = title.trim() || d.title
    const lead = d.links.length ? d.links.slice() : baseOf(w).cast.slice(0, 1).map((c) => c.n)
    const events = (w.ownEvents ??= [])
    if (d.editingEpisode) {
      const ep = w.eps[d.editingEpisode - (w.parent ? (w.forkAt ?? 0) : 0) - 1]
      if (!ep || ep.t !== d.baseTitle || JSON.stringify(ep.p) !== JSON.stringify(d.baseParas)) return { error: '공개 원고가 바뀌었어요. 최신 원고를 다시 열어 수정해 주세요' }
      Object.assign(ep, { t, p: d.paras.slice(), authorNote: d.authorNote.trim() })
      events.push([d.no, 'm', t + ' 수정 발행', lead])
      w.upd = 0
      await this.workRepository.saveWork(w)
      await this.workRepository.deleteDraft(key)
      return { ok: `${d.no}화 수정안을 발행했어요 (데모)`, go: `/studio/${id}?ep=${d.no}` }
    }
    w.eps.push({ t, p: d.paras.slice(), authorNote: d.authorNote.trim() })
    events.push([d.no, 'm', t + ' 공개', lead])
    w.upd = 0
    w.views = w.views || 1
    await this.workRepository.saveWork(w)
    await this.workRepository.deleteDraft(key)
    return { ok: w.private ? `${d.no}화를 발행했어요 · 작품은 비공개예요` : `${d.no}화를 공개했어요`, go: `/work/${id}` }
  }

  /** 목업 data-episode-visibility: index는 내가 쓴 회차(w.eps) 기준 */
  async toggleEpisode(id: string, index: number) {
    const w = await this.work(id)
    const ep = w && isMine(w) ? w.eps[index] : undefined
    if (!w || !ep) return null
    ep.hidden = !ep.hidden
    await this.workRepository.saveWork(w)
    return ep.hidden ? '이 회차의 공개를 중단했어요 (데모)' : '이 회차를 다시 공개했어요 (데모)'
  }

  /** 목업 downloadTxt(): 파일 이름과 내용만 만들고 저장은 화면이 합니다. */
  async exportText(id: string, key: string, all: boolean) {
    const w = (await this.work(id))!
    const d = (await this.workRepository.getDraft(key))!
    const eps = epsOf(w).map((e, i) => d.editingEpisode === i + 1 ? episodeText(i + 1, d.title, d.paras, d.authorNote) : episodeText(i + 1, e.t, e.p, e.authorNote))
    const current = episodeText(d.no, d.title, d.paras, d.authorNote)
    const name = w.title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'STORYFORK'
    return {
      name: `${name}_${all ? '전체원고' : `${d.no}화`}.txt`,
      content: all ? w.title + '\n\n' + (d.editingEpisode ? eps : [...eps, current]).join('\n\n---\n\n') : current,
    }
  }

  /** 목업 workMemo·data-ov·data-cast·data-narrative: 메모·한 줄 소개·시놉시스·서술 순서 */
  saveNotes(id: string, patch: Partial<Pick<Work, 'memo' | 'hook' | 'synopsis' | 'narrativeOrder'>>) { return this.change(id, (w) => { Object.assign(w, patch) }) }

  /** 목업 data-cast: 포크는 자기 스냅샷의 인물 상태만 바꿉니다. */
  setCastStatus(id: string, i: number, st: string) { return this.change(id, (w) => { const c = baseOf(w).cast[i]; if (c) c.st = st }) }

  /** 사전 문서 하나를 고치고 저장합니다. 세계관 문서가 바뀌면 규칙도 다시 만들어요. */
  private async editDoc<T>(id: string, docId: string, fn: (d: Doc, w: Work) => T) {
    const rules = new Map((await this.workRepository.listWorlds()).map((x) => [x.id, x.rules]))
    return this.change(id, (w) => {
      const d = wikiState(w).docs.find((x) => x.id === docId)
      if (!d) return null
      const r = fn(d, w)
      if (d.cat === 'world') syncRules(w, (x) => rules.get(x) ?? [])
      return r
    })
  }

  /** 목업 act==='wnew': 인물 문서는 등장인물에도 추가합니다. 새 문서 ID를 돌려줍니다. */
  async addDoc(id: string, cat: string, t: string) {
    const rules = new Map((await this.workRepository.listWorlds()).map((x) => [x.id, x.rules]))
    return this.change(id, (w) => {
      const d: Doc = { id: nid('d'), cat, t, alias: [], tags: [], props: cat === 'char' ? { 설명: '', 성격: '', 말투: '', 상태: '—' } : cat === 'world' ? { 종류: '규칙' } : {}, at: {}, img: null, body: '' }
      if (cat === 'event') Object.assign(d, { line: 'm', who: [], links: [] })
      wikiState(w).docs.push(d)
      const cast = baseOf(w).cast
      if (cat === 'char' && !cast.some((c) => c.n === t)) {
        cast.push({ n: t, c: AVATAR_COLORS[cast.length % AVATAR_COLORS.length], d: '', st: '—' })
        if (w.castFrom) w.castFrom[t] = Infinity
      }
      if (cat === 'world') syncRules(w, (x) => rules.get(x) ?? [])
      return d.id
    })
  }

  /** 목업 act==='wcat' */
  addCategory(id: string, n: string) { return this.change(id, (w) => { const cats = wikiState(w).cats; cats.push({ id: nid('c'), n, c: AVATAR_COLORS[cats.length % AVATAR_COLORS.length] }) }) }

  /** 목업 act==='wdel': 다른 사건의 연결에서도 지웁니다. 지운 문서의 분류를 돌려줍니다. */
  deleteDoc(id: string, docId: string) {
    return this.editDoc(id, docId, (d, w) => {
      const wiki = wikiState(w)
      wiki.docs = wiki.docs.filter((x) => x !== d)
      for (const x of wiki.docs) if (x.links) x.links = x.links.filter((l) => l.to !== d.id)
      return d.cat
    })
  }

  /** 목업 data-wf: 제목을 바꾸면 인물 이름도 바꿉니다. 빈 제목은 무시해요. */
  setDocText(id: string, docId: string, f: 't' | 'body', v: string) {
    return this.editDoc(id, docId, (d, w) => {
      if (f === 'body') { d.body = v; return }
      if (!v) return
      const old = d.t
      d.t = v
      if (d.cat !== 'char') return
      const c = baseOf(w).cast.find((x) => x.n === old)
      if (c) c.n = v
      if (w.castFrom) { w.castFrom[v] = w.castFrom[old]; delete w.castFrom[old] }
    })
  }

  /** 목업 data-wv·wprop: ep가 있으면 그 회차 시점 값으로 저장합니다. 상태는 인물 상태에도 반영해요. */
  setDocProp(id: string, docId: string, k: string, v: string, ep = 0) {
    return this.editDoc(id, docId, (d, w) => {
      if (ep) (d.at[ep] ??= {})[k] = v
      else d.props[k] = v
      if (k === '상태' && !ep && d.cat === 'char') { const c = baseOf(w).cast.find((x) => x.n === d.t); if (c) c.st = v }
    })
  }

  /** 목업 data-wk: 속성 이름을 바꾸고 순서는 그대로 둡니다. */
  renameDocProp(id: string, docId: string, k: string, nk: string) {
    return this.editDoc(id, docId, (d) => { if (nk && nk !== k) d.props = Object.fromEntries(Object.entries(d.props).map(([a, b]) => [a === k ? nk : a, b])) })
  }

  /** 목업 walias·walias-del·wtag */
  addDocChip(id: string, docId: string, f: 'alias' | 'tags', v: string) { return this.editDoc(id, docId, (d) => { d[f].push(v) }) }
  removeAlias(id: string, docId: string, i: number) { return this.editDoc(id, docId, (d) => { d.alias.splice(i, 1) }) }

  /** 목업 act==='addev' */
  async addEvent(id: string, key: string) {
    const d = await this.workRepository.getDraft(key)
    return d && this.change(id, (w) => { (w.ownEvents ??= []).push([d.no, 'f', '복선: ' + (d.title || '새 사건'), d.links.slice()]) })
  }

  /** 목업 #takeSim: 결과는 참고 자료로만 남고 원고·설정은 바뀌지 않습니다. */
  async takeSim(id: string, key: string, situation: string, picked: string[], turns: number) {
    const d = await this.update(key, (x) => { x.sim = { summary: `${situation.slice(0, 24)}… (${turns}턴)` } })
    return d && this.change(id, (w) => { (w.ownEvents ??= []).push([d.no, 's', '시뮬레이션: ' + situation.slice(0, 18) + '…', picked]) })
  }

  /** 목업 act==='autoToggle'. 켤 때의 비용 안내 확인은 화면이 합니다. */
  toggleAuto(id: string) {
    return this.change(id, (w) => {
      const A = w.auto = autoOf(w)
      A.on = !A.on
      A.status = A.on ? '실행 중' : '꺼짐'
      return A.on ? 'AI 자율 연재를 켰어요 (데모 · 실제 예약 없음)' : 'AI 자율 연재를 껐어요'
    })
  }

  pauseAuto(id: string) { return this.change(id, (w) => { const A = w.auto = autoOf(w); A.status = A.status === '실행 중' ? '일시 중지' : '실행 중' }) }

  setAuto(id: string, k: 'react' | 'requireReview', v: boolean) { return this.change(id, (w) => { (w.auto = autoOf(w))[k] = v }) }

  /** 목업 act==='autoGen'·autoGen(id): 고정 예시 회차를 만들어 바로 공개하거나, 작가 확인을 켰으면 초안으로만 둡니다. */
  async autoGen(id: string, approve: (credits: number) => boolean): Promise<string | null> {
    const w = await this.work(id)
    if (!w || !isMine(w)) return null
    const A = w.auto = autoOf(w)
    if (!A.on || A.status !== '실행 중') return '자율 연재를 다시 시작해 주세요'
    if (w.private || w.hidden) return '작품을 공개할 권한과 상태를 먼저 확인해 주세요'
    const { key, draft: d } = await this.draftOf(w)
    if (d.paras.length) return '작성 중인 초안이 있어 자동 발행을 건너뛰었어요'
    if ((await this.creditRepository.get()).credits < 5) {
      A.status = '중단됨'
      await this.workRepository.saveWork(w)
      return '데모 크레딧이 부족해 자율 연재를 중단했어요'
    }
    const r = await new CreditUseCase(this.creditRepository).spend('AI 자율 연재', 5, approve)
    if (r === 'fail') {
      A.failures = (A.failures ?? 0) + 1
      if (A.failures >= 3) A.status = '중단됨'
      await this.workRepository.saveWork(w)
      return AI_FAIL_MSG
    }
    if (r !== 'ok') return r === 'short' ? AI_SHORT_MSG : null
    A.failures = 0
    d.paras = propOf(w).slice()
    d.title = d.title === '새 회차' ? 'AI 자율 연재 ' + d.no + '화' : d.title
    d.auto = true
    if (A.requireReview) {
      A.log.push(`· ${d.no}화 초안 생성 · 작가 확인 대기`)
      await this.workRepository.saveDraft(key, d)
      await this.workRepository.saveWork(w)
      return '데모 예시 초안을 만들었어요. 검토한 뒤 일반 발행 흐름에서 공개해 주세요.'
    }
    const cms = await this.feedbackRepository.countComments(id)
    w.eps.push({ t: d.title, p: d.paras.slice(), authorNote: d.authorNote.trim(), ai: true })
    ;(w.ownEvents ??= []).push([d.no, 'm', d.title + ' (AI 자율 연재)', [baseOf(w).cast[0]?.n ?? '']])
    A.log.push(`· ${d.no}화 자동 공개 (독자 반응 ${A.react ? cms + '건 반영' : '미반영'})`)
    await this.workRepository.saveWork(w)
    await this.workRepository.deleteDraft(key)
    // ponytail: 작품 설정의 '세계관 자동 업데이트'(worldExtract)는 옮기지 않았어요. 설정 탭에 그 선택지가 생기면 여기서 실행해요.
    return `AI가 ${w.eps.length}화를 쓰고 공개했어요 (데모)`
  }

  /** 목업 publishSheet() #savepub: U21 공개 범위·회차별 포크 허용·권리 확인 */
  async savePublishSettings(id: string, st: PublishSettings): Promise<{ error: string } | { ok: string }> {
    if (!st.ok && st.vis === '모두') return { error: '공개하려면 권리 확인에 체크해 주세요' }
    if (st.on && !st.all && !st.eps.length) return { error: '포크를 허용할 회차를 하나 이상 골라 주세요' }
    const worlds = await this.workRepository.listWorlds()
    const label = await this.change(id, (w) => {
      w.private = st.vis === '나만'
      w.forkAll = st.on && st.all
      w.forkEps = [...st.eps].sort((a, b) => a - b)
      w.forksAllowed = st.on
      w.forkFrom = st.on ? (w.forkAll ? 1 : w.forkEps[0] || 1) : 0
      w.kind = st.kind
      w.rights = st.ok ? '확인됨' : '미확인'
      if (w.rights === '미확인') w.forksAllowed = false
      return forkLabel(w, worlds)
    })
    return label === null ? { error: '내 소설만 설정할 수 있어요' } : { ok: '공개 설정을 저장했어요 · ' + label }
  }
}

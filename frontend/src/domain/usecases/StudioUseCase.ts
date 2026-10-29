import { draftKey, episodeDraft, newEpisodeDraft, type Draft } from '../entities/draft'
import { baseOf, epsOf, isMine, type Role, type Work } from '../entities/work'
import type { WorkRepository } from '../repositories/WorkRepository'

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

const episodeText = (n: number, t: string, p: string[], note?: string) => `${n}화 ${t}\n\n${p.join('\n\n')}${note ? '\n\n작가의 말\n\n' + note : ''}`

/** 목업 studio(): U13 집필실 원고 화면. 초안은 저장소에 두고 발행할 때만 회차 정본을 바꿉니다. */
export class StudioUseCase {
  private readonly workRepository: WorkRepository
  constructor(workRepository: WorkRepository) { this.workRepository = workRepository }

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
}

import { AVATAR_COLORS, epsOf, forkLabel, forksOf, isMine, isPub, nid, original, type Work } from '../entities/work'
import { publicWorldRules, worldVersion, type World, type WorldVersion } from '../entities/world'
import type { FeedbackRepository } from '../repositories/FeedbackRepository'
import type { ReadingRepository, WorkRepository } from '../repositories/WorkRepository'
import type { WorldRepository } from '../repositories/WorldRepository'

export const NOVEL_GENRES = ['판타지','현대판타지','무협','선협','퓨전','로맨스','로맨스판타지','BL','GL','현대','시대물','역사','대체역사','SF','게임','스포츠','드라마','미스터리','추리','스릴러','공포','오컬트','액션','전쟁·밀리터리','라이트노벨','학원','일상','고전','일반소설','기타']
export const NOVEL_TAG_GROUPS: Record<string, string[]> = {
  '전개·인물': ['회귀','빙의','환생','타임슬립','차원이동','이세계','평행세계','루프','기억상실','성장','복수','구원','생존','착각계','오해','비밀','반전','먼치킨','천재 주인공','정체 숨김'],
  '판타지·세계': ['헌터','던전','게이트','탑등반','성좌','상태창','시스템','레벨업','마법','마법학교','기사','드래곤','정령','신화','마왕','몬스터','이종족','길드','아포칼립스','포스트아포칼립스','좀비','재난','디스토피아','가상현실'],
  '로맨스·관계': ['로맨스','로맨스판타지','BL','GL','첫사랑','짝사랑','재회','계약연애','계약결혼','정략결혼','선결혼후연애','친구에서연인','혐관','삼각관계','다각관계','순애','집착','후회','연하','연상','육아','가족','입양','악역영애','강한여주','여주성장'],
  '현대·직업': ['현대물','현대판타지','재벌','기업경영','전문직','의학','법정','수사','연예계','아이돌','배우','스포츠','e스포츠','게임','요리','공무원','경찰','군인','회사생활','캠퍼스','학원','방송','스트리머','음악','일상','힐링'],
  '추리·분위기': ['추리','미스터리','스릴러','서스펜스','공포','괴담','오컬트','범죄','액션','모험','전쟁','밀리터리','정치','궁중암투','영지경영','경영','드라마','코미디','풍자','느와르','생존물','성장물'],
  '시대·장르': ['역사','대체역사','동양풍','서양풍','시대극','무협','선협','SF','우주','스페이스오페라','퓨전','고전','라이트노벨','청춘','청소년'],
}

/** 목업 IMPORT: 가상 추출 결과 */
export const IMPORT = {
  file: '춘향전_전문.txt', size: '286KB',
  cast: ['성춘향 · 퇴기 월매의 딸', '이몽룡 · 남원 부사의 아들', '변학도 · 새로 온 남원 부사', '월매 · 춘향의 어머니', '방자 · 몽룡의 몸종'],
  world: ['배경: 조선 숙종 대', '장소: 남원 광한루 · 오작교 · 한양', '규칙: 신분이 다른 혼인은 공식 인정되지 않는다', '규칙: 수청을 거부하면 처벌받는다'],
  events: ['1화 단옷날 광한루의 만남', '2화 백년가약과 이별', '3화 변학도의 수청 요구', '4화 암행어사 출두'],
}

export type NewWorkInput = {
  worldIds: string[]; schedule: string[]; tags: string[]; title: string; summary: string; localRules: string
  cast: { n: string; d: string }[]; genre: string; rating: string; fork: '0' | 'all' | 'eps'; cover: string | null
}
export type WorldForm = { name: string; description: string; rules: string }
export type WorldPermission = 'allowUse' | 'allowFork' | 'allowAI' | 'allowPaid'
type Result = { error: string } | { id: string }

const lines = (s: string) => [...new Set(s.split('\n').map((x) => x.trim()).filter(Boolean))]
const mineOnly = (worlds: World[], id: string) => worlds.find((w) => w.id === id && !w.owner)

/** 목업 lib()·write()·newWork()·worldManager·importer(): 내 서재와 창작 시작 */
export class LibraryUseCase {
  private readonly workRepository: WorkRepository
  private readonly worldRepository: WorldRepository
  private readonly readingRepository: ReadingRepository
  private readonly feedbackRepository: FeedbackRepository
  constructor(workRepository: WorkRepository, worldRepository: WorldRepository, readingRepository: ReadingRepository, feedbackRepository: FeedbackRepository) {
    this.workRepository = workRepository
    this.worldRepository = worldRepository
    this.readingRepository = readingRepository
    this.feedbackRepository = feedbackRepository
  }

  /** U11 읽는 중: 이어 읽기와 관심 소설 */
  async getRead() {
    const [works, progress] = await Promise.all([this.workRepository.listWorks(), this.readingRepository.getProgress()])
    const byId = (id: string) => works.find((w) => w.id === id)
    return {
      recent: Object.keys(progress.last).map(byId).filter((w): w is Work => !!w && epsOf(w).length > 0)
        .map((work) => ({ work, n: Math.min(progress.last[work.id], epsOf(work).length), tot: epsOf(work).length })),
      liked: Object.keys(progress.liked).filter((k) => progress.liked[k]).map(byId).filter((w): w is Work => !!w),
    }
  }

  /** U11 내 댓글·신고 */
  async getReports() {
    const [works, reports] = await Promise.all([this.workRepository.listWorks(), this.feedbackRepository.listReports()])
    return reports.map((r) => ({ ...r, title: works.find((w) => w.id === r.w)?.title ?? '' }))
  }

  /** 목업 pend(): 작가가 처리할 피드백 수 */
  async pending() {
    return (await this.feedbackRepository.listInbox()).filter((i) => ['작가 검토 대기', '수정 진행 중', '발행 대기'].includes(i.status)).length
  }

  /** U12 내가 쓰는 소설 */
  async getWrite() {
    const [works, worlds, pending] = await Promise.all([this.workRepository.listWorks(), this.worldRepository.list(), this.pending()])
    const mine = await Promise.all(works.filter(isMine).map(async (work) => ({
      work,
      parent: works.find((w) => w.id === work.parent),
      writingNext: !!(await this.workRepository.getDraft(work.id))?.paras.length,
      pub: isPub(work),
      forkLabel: forkLabel(work, worlds),
      forkCount: forksOf(works, work.id).length,
    })))
    return { mine, pending }
  }

  /** U28 세계관 목록: 내 세계관, 이용 가능한 공개 세계관, 조합 가능한 세계관 */
  async getWorlds() {
    const worlds = await this.worldRepository.list()
    return {
      mine: worlds.filter((w) => !w.owner),
      usable: worlds.filter((w) => w.owner && w.public && w.allowUse).map((w) => ({ world: w, rules: publicWorldRules(w) })),
      combinable: worlds.filter((w) => !w.owner || (w.public && w.allowUse && w.allowFork))
        .map((w) => ({ world: w, rules: (w.owner ? publicWorldRules(w) : w.rules).map((r) => ({ rule: r, index: w.rules.indexOf(r) })) })),
      linkable: worlds.filter((w) => !w.owner || (w.public && w.allowUse)),
    }
  }

  private async addWorld(world: World) {
    worldVersion(world)
    await this.worldRepository.save(world)
    return { id: world.id }
  }

  async createWorld(f: WorldForm): Promise<Result> {
    const name = f.name.trim()
    if (!name) return { error: '세계관 이름을 적어 주세요' }
    return this.addWorld({ id: nid('world'), name, description: f.description.trim(), rules: lines(f.rules), public: false })
  }

  async combineWorlds(name: string, picks: { worldId: string; ruleIndex: number }[]): Promise<Result> {
    const worlds = await this.worldRepository.list()
    const selected = picks.map((p) => {
      const source = worlds.find((w) => w.id === p.worldId && (!w.owner || (w.public && w.allowUse && w.allowFork)))
      return source && { source, rule: source.rules[p.ruleIndex] }
    }).filter((x): x is { source: World; rule: string } => !!x?.rule)
    if (!name.trim() || !selected.length) return { error: '이름과 항목을 선택해 주세요' }
    return this.addWorld({
      id: nid('world'), name: name.trim(), description: '', rules: [...new Set(selected.map((x) => x.rule))], public: false,
      sources: selected.filter((x) => x.source.owner).map((x) => ({ id: x.source.id, owner: x.source.owner! })),
    })
  }

  async copyWorld(id: string) {
    const source = (await this.worldRepository.list()).find((w) => w.id === id && w.owner && w.public && w.allowFork)
    if (!source) return null
    return this.addWorld({ id: nid('world'), name: source.name + ' 포크', description: source.description, rules: publicWorldRules(source), public: false, source: { id: source.id, owner: source.owner! } })
  }

  /** 목업 saveWorld(): 연결 작품에서 규칙을 빼야 하면 confirmed가 필요합니다. */
  private async saveWorld(world: World, next: Partial<WorldVersion> & Pick<World, 'rules'>, confirmed: boolean) {
    const works = await this.workRepository.listWorks()
    const worlds = await this.worldRepository.list()
    const linked = works.filter((w) => (w.worldIds ?? []).includes(world.id))
    const removed = world.rules.filter((r) => !next.rules.includes(r))
    const added = next.rules.filter((r) => !world.rules.includes(r))
    if (linked.length && removed.length && !confirmed) return false
    Object.assign(world, next)
    worldVersion(world)
    await this.worldRepository.save(world)
    for (const work of linked) {
      const otherRules = (work.worldIds ?? []).filter((id) => id !== world.id).flatMap((id) => worlds.find((x) => x.id === id)?.rules ?? [])
      for (const rule of removed) {
        if (otherRules.includes(rule) || (work.localRules ?? []).includes(rule)) continue
        work.rules = work.rules.filter((r) => r !== rule)
        const docs = work.wiki?.docs.filter((d) => d.cat === 'world' && d.t === rule) ?? []
        if (work.wiki && docs.length) {
          ;(work.removedWorldDocs ??= {})[rule] = docs
          work.wiki.docs = work.wiki.docs.filter((d) => !docs.includes(d))
        }
      }
      for (const rule of added) {
        if (work.rules.includes(rule)) continue
        work.rules.push(rule)
        if (!Object.hasOwn(work.ruleFrom ??= {}, rule)) work.ruleFrom[rule] = Infinity
        if (!work.wiki) continue
        const saved = work.removedWorldDocs?.[rule]
        if (saved) { work.wiki.docs.push(...saved); delete work.removedWorldDocs![rule] }
        else work.wiki.docs.push({ id: nid('d'), cat: 'world', t: rule, alias: [], tags: ['규칙'], props: { 종류: '규칙', 설정검사: '사용' }, at: {}, img: null, body: rule + '.' })
      }
      await this.workRepository.saveWork(work)
    }
    return true
  }

  async editWorld(id: string, f: WorldForm, confirmed: boolean): Promise<{ error: string } | { needsConfirm: true } | { ok: true }> {
    const world = (await this.worldRepository.list()).find((w) => w.id === id)
    const name = f.name.trim()
    if (!world || !name) return { error: '세계관 이름을 적어 주세요' }
    const ok = await this.saveWorld(world, { name, description: f.description.trim(), rules: lines(f.rules), public: world.public }, confirmed)
    return ok ? { ok: true } : { needsConfirm: true }
  }

  async restoreWorld(id: string, version: number, confirmed = true) {
    const world = (await this.worldRepository.list()).find((w) => w.id === id)
    const v = world?.history?.[version]
    return !!world && !!v && this.saveWorld(world, structuredClone(v), confirmed)
  }

  private async updateMine(id: string, change: (w: World) => void) {
    const world = mineOnly(await this.worldRepository.list(), id)
    if (!world) return false
    change(world)
    worldVersion(world)
    await this.worldRepository.save(world)
    return true
  }

  togglePublic(id: string) { return this.updateMine(id, (w) => { w.public = !w.public }) }
  setRulePublic(id: string, index: number, on: boolean) {
    return this.updateMine(id, (w) => { const rule = w.rules[index]; if (rule) (w.rulePublic ??= {})[rule] = on })
  }
  setPermission(id: string, key: WorldPermission, on: boolean) { return this.updateMine(id, (w) => { w[key] = on }) }

  async deleteWorld(id: string): Promise<{ error: string } | { ok: true }> {
    if ((await this.workRepository.listWorks()).some((w) => (w.worldIds ?? []).includes(id))) return { error: '연결된 작품이 있어 삭제할 수 없어요' }
    await this.worldRepository.remove(id)
    return { ok: true }
  }

  /** 목업 createWork */
  async createWork(i: NewWorkInput): Promise<Result> {
    if (!i.worldIds.length || i.worldIds.length > 5) return { error: '세계관을 1~5개 선택해 주세요' }
    if (!i.schedule.length) return { error: '연재 요일 또는 비정기 연재를 선택해 주세요' }
    if (i.tags.length < 2) return { error: '태그를 2개 이상 추가해 주세요' }
    const t = i.title.trim()
    if (!t) return { error: '제목을 적어 주세요' }
    const cast = i.cast.map((c) => ({ n: c.n.trim(), d: c.d.trim() })).filter((c) => c.n)
    if (!cast.length) return { error: '인물을 1명 이상 적어 주세요' }
    const worlds = (await this.worldRepository.list()).filter((w) => i.worldIds.includes(w.id) && (!w.owner || (w.public && w.allowUse)))
    if (worlds.length !== i.worldIds.length) return { error: '이용할 수 없는 세계관이 있어요' }
    const localRules = lines(i.localRules)
    const rules = [...new Set(worlds.flatMap((w) => w.owner ? publicWorldRules(w) : w.rules).concat(localRules))]
    const fk = i.fork === '0' ? 0 : 1
    const summary = i.summary.trim()
    const w = original({
      id: nid('mine'), worldIds: i.worldIds, localRules, ruleFrom: Object.fromEntries(rules.map((r) => [r, Infinity])), eventFrom: {},
      castFrom: Object.fromEntries(cast.map((c) => [c.n, Infinity])), title: t,
      theme: i.genre === 'SF' ? 'neon' : ['고전', '역사', '대체역사', '시대물'].includes(i.genre) ? 'hanji' : 'star',
      genre: i.genre, author: '나', owner: 'me', kind: '자체 창작', rights: '확인됨', private: true, rating: i.rating, schedule: [...i.schedule],
      by: '글 나 · 직접 창작한 소설', tags: [...i.tags], hash: i.tags.map((x) => '#' + x), likes: 0, views: 0, cmts: 0, upd: 0,
      hero: [t, ''], heroBg: '#232A63', hook: summary || t, summary: summary || '아직 소개가 없어요.', forkFrom: fk,
      cast: cast.map((c, n) => ({ n: c.n, c: AVATAR_COLORS[n % AVATAR_COLORS.length], d: c.d || '인물', st: '—' })),
      rules, events: [], eps: [], forkAll: i.fork === 'all', forkEps: [], coverImg: i.cover,
    })
    if (!fk) w.forksAllowed = false
    await this.workRepository.saveWork(w)
    return { id: w.id }
  }

  /** 목업 saveimp */
  async saveImport({ kind, worldId }: { kind: string; worldId: string }): Promise<{ error: string } | { ok: true }> {
    const works = await this.workRepository.listWorks()
    if (works.some((w) => w.id === 'chunhyang')) return { error: '이미 저장했어요' }
    const world = mineOnly(await this.worldRepository.list(), worldId)
    if (!world) return { error: '연결할 내 세계관을 선택해 주세요' }
    const localRules = IMPORT.world.filter((x) => x.startsWith('규칙')).map((x) => x.slice(4))
    const rules = [...new Set(world.rules.concat(localRules))]
    const w = original({
      id: 'chunhyang', worldIds: [world.id], localRules, eventFrom: {}, ruleFrom: Object.fromEntries(rules.map((r) => [r, Infinity])),
      castFrom: Object.fromEntries(IMPORT.cast.map((c) => [c.split(' · ')[0], Infinity])), title: '춘향전 (가져온 소설)', theme: 'hanji',
      genre: '고전 로맨스', author: '나', owner: 'me', kind, rights: kind === '다른 사람 소설' ? '미확인' : '확인됨', private: true,
      by: '가져온 소설 · ' + kind, tags: [], hash: ['#광한루', '#고전리메이크'], likes: 0, views: 0, cmts: 0, upd: 0,
      hero: ['단옷날 광한루,', '그네 타던 소녀'], heroBg: '#5B4A3A', hook: '단옷날, 그네 위의 춘향', summary: '남원 광한루에서 만난 춘향과 몽룡의 소설.', forkFrom: 2,
      cast: IMPORT.cast.map((c, n) => ({ n: c.split(' · ')[0], c: AVATAR_COLORS[n % AVATAR_COLORS.length], d: c.split(' · ')[1] || '', st: '—' })),
      rules, events: IMPORT.events.map((e) => [+e[0], 'm', e.slice(3), []]),
      eps: [{ t: '광한루', p: ['단옷날, 남원 광한루 앞 버드나무에 그네가 걸렸다.', '이몽룡은 그네 위의 소녀에게서 눈을 떼지 못했다.'] }],
    })
    if (w.rights === '미확인') w.forksAllowed = false
    await this.workRepository.saveWork(w)
    return { ok: true }
  }
}

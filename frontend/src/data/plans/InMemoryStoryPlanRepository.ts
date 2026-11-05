import { validatePlan, validatePlanReferences, type PlanInput, type PlanReferences, type StoryPlan } from '../../domain/entities/storyPlan'
import { epsOf, isMine } from '../../domain/entities/work'
import { wikiState } from '../../domain/entities/wiki'
import type { StoryPlanRepository } from '../../domain/repositories/StoryPlanRepository'
import type { WorkRepository } from '../../domain/repositories/WorkRepository'

/** 계획만 별도 보관하는 메모리 데모. 사전·사건·원고 정본은 수정하지 않습니다. */
export class InMemoryStoryPlanRepository implements StoryPlanRepository {
  private rows = new Map<string, StoryPlan & { deleted: boolean }>()
  private readonly works: WorkRepository
  constructor(works: WorkRepository) { this.works = works }
  private async own(workId: string) {
    const work = (await this.works.listWorks()).find(w => w.id === workId)
    if (!work || !isMine(work)) throw new Error('작품을 찾을 수 없거나 편집 권한이 없어요.')
    return work
  }
  private get(workId: string, id: string) {
    const row = this.rows.get(id)
    if (!row || row.workId !== workId || row.deleted) throw new Error('계획을 찾을 수 없어요.')
    return row
  }
  async references(workId: string) {
    const work = await this.own(workId)
    const docs = wikiState(work).docs
    return {
      characters: docs.filter(d => d.cat === 'char').map(d => ({ id: d.id, name: d.t })),
      places: docs.filter(d => d.cat === 'place').map(d => ({ id: d.id, name: d.t })),
      episodes: epsOf(work).map((e, i) => ({ number: i + 1, title: e.t })),
    }
  }
  async list(workId: string) {
    const refs = await this.references(workId)
    return [...this.rows.values()].filter(p => p.workId === workId && !p.deleted).map(p => this.view(p, refs))
  }
  async read(workId: string, id: string) { const refs = await this.references(workId); return this.view(this.get(workId, id), refs) }
  private view(row: StoryPlan, refs: PlanReferences): StoryPlan {
    return structuredClone({ ...row, episodeMissing: row.episodeNumber !== null && !refs.episodes.some(e => e.number === row.episodeNumber) })
  }
  async save(workId: string, value: PlanInput, previous?: StoryPlan) {
    await this.own(workId)
    validatePlan(value)
    validatePlanReferences(value, await this.references(workId))
    // Recheck after asynchronous reference loading so two pending writes cannot share a revision.
    const before = previous ? this.get(workId, previous.id) : undefined
    if (before && before.revision !== previous?.revision) throw new Error('다른 변경이 저장됐어요. 입력을 보관하고 다시 불러와 주세요.')
    if (before && (before.kind !== value.kind || before.parentId !== value.parentId)) throw new Error('계획 종류와 소속 플롯은 바꿀 수 없어요.')
    if (value.parentId && this.get(workId, value.parentId).kind !== 'plot') throw new Error('소속 플롯을 찾을 수 없어요.')
    const saved = { ...structuredClone(value), id: before?.id ?? crypto.randomUUID(), workId, revision: (before?.revision ?? 0) + 1, episodeMissing: false, deleted: false }
    this.rows.set(saved.id, saved)
    return structuredClone(saved)
  }
  async remove(workId: string, plan: StoryPlan) {
    await this.own(workId)
    const row = this.get(workId, plan.id)
    if (row.revision !== plan.revision) throw new Error('다른 변경이 저장됐어요. 다시 불러와 주세요.')
    if ([...this.rows.values()].some(p => p.workId === workId && p.parentId === plan.id && !p.deleted)) throw new Error('하위 장면 계획을 먼저 삭제해 주세요.')
    row.deleted = true; row.revision++
  }
}

import { validatePlan, type PlanInput, type StoryPlan } from '../entities/storyPlan'
import type { StoryPlanRepository } from '../repositories/StoryPlanRepository'

export class StoryPlanUseCase {
  private readonly repository: StoryPlanRepository
  constructor(repository: StoryPlanRepository) { this.repository = repository }
  list(workId: string, signal?: AbortSignal) { return this.repository.list(workId, signal) }
  read(workId: string, id: string, signal?: AbortSignal) { return this.repository.read(workId, id, signal) }
  references(workId: string, signal?: AbortSignal) { return this.repository.references(workId, signal) }
  async reviewDeletion(workId: string, id: string, signal?: AbortSignal) {
    const plans = await this.repository.list(workId, signal)
    return { plans, target: plans.find(plan => plan.id === id) ?? null }
  }
  async save(workId: string, value: PlanInput, previous?: StoryPlan, signal?: AbortSignal) {
    validatePlan(value)
    return this.repository.save(workId, { ...value, title: value.title.trim() }, previous, signal)
  }
  /** 순서만 저장한다. 밀린 이웃의 revision도 바뀌므로 화면은 저장 성공을 알린 뒤 목록을 따로 다시 읽는다. */
  move(workId: string, plan: StoryPlan, position: number, signal?: AbortSignal) {
    const { kind, parentId, title, content, episodeNumber, characterIds, placeIds } = plan
    return this.save(workId, { kind, parentId, title, content, episodeNumber, characterIds, placeIds, position }, plan, signal)
  }
  remove(workId: string, plan: StoryPlan, signal?: AbortSignal) { return this.repository.remove(workId, plan, signal) }
}

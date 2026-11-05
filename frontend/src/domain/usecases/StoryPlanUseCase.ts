import { validatePlan, type PlanInput, type StoryPlan } from '../entities/storyPlan'
import type { StoryPlanRepository } from '../repositories/StoryPlanRepository'

export class StoryPlanUseCase {
  private readonly repository: StoryPlanRepository
  constructor(repository: StoryPlanRepository) { this.repository = repository }
  list(workId: string, signal?: AbortSignal) { return this.repository.list(workId, signal) }
  read(workId: string, id: string, signal?: AbortSignal) { return this.repository.read(workId, id, signal) }
  references(workId: string, signal?: AbortSignal) { return this.repository.references(workId, signal) }
  async save(workId: string, value: PlanInput, previous?: StoryPlan, signal?: AbortSignal) {
    validatePlan(value)
    return this.repository.save(workId, { ...value, title: value.title.trim() }, previous, signal)
  }
  remove(workId: string, plan: StoryPlan, signal?: AbortSignal) { return this.repository.remove(workId, plan, signal) }
}

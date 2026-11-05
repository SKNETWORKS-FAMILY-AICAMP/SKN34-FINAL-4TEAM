import type { PlanInput, PlanReferences, StoryPlan } from '../entities/storyPlan'

export interface StoryPlanRepository {
  list(workId: string, signal?: AbortSignal): Promise<StoryPlan[]>
  read(workId: string, id: string, signal?: AbortSignal): Promise<StoryPlan>
  save(workId: string, value: PlanInput, previous?: StoryPlan, signal?: AbortSignal): Promise<StoryPlan>
  remove(workId: string, plan: StoryPlan, signal?: AbortSignal): Promise<void>
  references(workId: string, signal?: AbortSignal): Promise<PlanReferences>
}

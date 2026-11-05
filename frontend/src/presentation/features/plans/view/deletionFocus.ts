import type { StoryPlan } from '../../../../domain/entities/storyPlan'

/** 같은 목록의 다음 항목부터 찾고, 없으면 이전 항목으로 돌아간다. */
export function deletionFocusOrder(plans: StoryPlan[], target: StoryPlan): string[] {
  const siblings = plans.filter(plan => plan.workId === target.workId && plan.kind === target.kind && plan.parentId === target.parentId)
  const index = siblings.findIndex(plan => plan.id === target.id)
  if (index < 0) return []
  return [...siblings.slice(index + 1), ...siblings.slice(0, index).reverse()].map(plan => plan.id)
}

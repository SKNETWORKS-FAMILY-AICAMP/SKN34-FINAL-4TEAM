export type PlanInput = {
  kind: 'plot' | 'scene'
  parentId: string | null
  title: string
  content: string
  episodeNumber: number | null
  characterIds: string[]
  placeIds: string[]
}
export type StoryPlan = PlanInput & { id: string; workId: string; revision: number; episodeMissing: boolean }
export type PlanReferences = {
  characters: { id: string; name: string }[]
  places: { id: string; name: string }[]
  episodes: { number: number; title: string }[]
}

export function validatePlan(value: PlanInput) {
  if (!value.title.trim() || value.title.length > 120 || value.content.length > 8000) throw new Error('제목은 1~120자, 계획 내용은 8,000자 이내로 입력해 주세요.')
  if ((value.kind === 'scene') !== !!value.parentId) throw new Error('장면 계획은 소속 플롯을 선택해야 해요.')
  if (value.kind === 'plot' && (value.episodeNumber !== null || value.characterIds.length || value.placeIds.length)) throw new Error('회차·인물·장소는 장면 계획에서 연결해 주세요.')
  if (value.episodeNumber !== null && (!Number.isInteger(value.episodeNumber) || value.episodeNumber < 1)) throw new Error('올바른 회차를 선택해 주세요.')
  for (const ids of [value.characterIds, value.placeIds]) if (ids.length > 30 || new Set(ids).size !== ids.length || ids.some(id => !id || id.length > 200)) throw new Error('인물·장소는 중복 없이 각각 30개까지 선택해 주세요.')
}

export function validatePlanReferences(value: PlanInput, refs: PlanReferences) {
  if (value.episodeNumber !== null && !refs.episodes.some(e => e.number === value.episodeNumber)) throw new Error('연결할 회차를 찾을 수 없어요. 다시 선택해 주세요.')
  for (const [ids, options] of [[value.characterIds, refs.characters], [value.placeIds, refs.places]] as const) {
    if (ids.some(id => !options.some(option => option.id === id))) throw new Error('연결할 인물·장소를 찾을 수 없어요. 다시 선택해 주세요.')
  }
}

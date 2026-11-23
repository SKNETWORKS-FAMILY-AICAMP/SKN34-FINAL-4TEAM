import type { CardType } from '../../../../domain/entities/studioCards'

/*
 * 관계도 필터(끈 유형·관계 종류)의 기기 한정 기억(localStorage): 세계관별로 남긴다.
 * ponytail: 기기·브라우저마다 따로이고 서버에는 가지 않는다. 기기 사이에 유지하려면 서버 저장(세계관 보기 설정 API)이 필요하다.
 * 저장소가 막혀 있거나 가득 차도(예외) 보기는 계속되도록 조용히 건너뛴다. 읽기도 실패하면 저장한 적이 없는 것으로 본다.
 */
export const relationKey = (worldId: string) => 'storyfork.relation-filter.' + worldId

export type RelationFilter = { hiddenTypes: CardType[]; hiddenKinds: string[] }

function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
}
function write(key: string, value: unknown) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)) } catch { /* 저장소를 쓸 수 없다: 이번 보기만 유지된다 */ }
}
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

/** 저장한 필터. 저장한 적이 없거나 모양이 다르면 null이다. */
export function loadFilter(worldId: string): RelationFilter | null {
  const value = read(relationKey(worldId)) as Partial<RelationFilter> | null
  return value && strings(value.hiddenTypes) && strings(value.hiddenKinds) ? { hiddenTypes: value.hiddenTypes as CardType[], hiddenKinds: value.hiddenKinds } : null
}
export const saveFilter = (worldId: string, filter: RelationFilter) => write(relationKey(worldId), filter)
export const clearFilter = (worldId: string) => write(relationKey(worldId), null)

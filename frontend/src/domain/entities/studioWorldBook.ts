import { beyondNovel, cardRevealEpisode, type StudioSetting } from './studioWorld'

/*
 * 집필실 설정집 보기(#986): 집필실 왼쪽 메뉴의 `설정집`이 연결된 세계관의 설정 카드를 읽기만 하는 화면의 순수 규칙.
 * 검색(`cardLibraryRows`)·분류 묶음·이웃 관계(`cardRelationEntries`)는 세계관 관리와 같은 기존 규칙을 그대로 쓴다.
 */

/** `설정집` 버튼 상태: 연결된 세계관을 알아야(ready) 열린다. 나머지는 잠그고 이유를 알린다. */
export type BookState = 'ready' | 'loading' | 'failed' | 'unlinked'

/**
 * 연결된 세계관 조회(`useLinkedWorld`)의 결과로 버튼 상태를 정한다. 세계관 id를 이미 알면 다시 확인하는 중이거나 다시 확인에 실패해도 열려 있다(알던 세계관을 읽으면 그 결과가 스스로 실패를 알린다).
 * id를 모르면 실패 → 확인 중 순이고, 연결이 없다고 읽었어도 그 뒤 다시 확인에 실패했다면 연결 없음으로 단정하지 않고 실패로 알린다.
 */
export function bookState({ worldId, isLoading, isError }: { worldId: string | null | undefined; isLoading: boolean; isError: boolean }): BookState {
  if (worldId) return 'ready'
  if (isError) return 'failed'
  if (isLoading || worldId === undefined) return 'loading'
  return 'unlinked'
}

/**
 * 독자에게 아직 보이지 않는 카드인가: 공개 회차를 정하지 않았거나(작가 전용, 옛 공개 카드는 1화부터) 연결된 소설에 아직 없는 회차로 정했다.
 * [limit]은 소설의 마지막 회차이고 모르면(undefined) 없는 회차 이야기를 지어내지 않는다(`beyondNovel`).
 */
export function authorOnlyCard(setting: StudioSetting, limit?: number): boolean {
  const episode = cardRevealEpisode(setting)
  return episode === undefined || beyondNovel(episode, limit)
}

import { appContainer } from '../../../app/appContainer'
import { beatCharacterIds, inheritedCharacters, planBeats, worldCharacters } from '../../../domain/entities/characterSimulation'
import { useAsyncData } from '../useAsyncData'

/**
 * 이 작품에 연결된 내 세계관의 id. 없으면(연결 없음·아직 읽는 중·읽지 못함) null이다. 이어받은 원작 세계관은 읽기 전용이라 편집 화면이 없으므로 null이다.
 * 집필실에서 설정집으로 이동하거나(#601), 비트 거부로 멈춘 장면에서 해당 인물 카드 편집 화면으로 이동할 때 쓴다(#356).
 */
export function useLinkedWorldId(workId: string) {
  const worlds = appContainer.resolve('worldStudioUseCase')
  const { data } = useAsyncData(async (signal) => (await worlds.list(signal)).find((world) => world.linkedWorkId === workId)?.id ?? null, [worlds, workId])
  return data ?? null
}

/**
 * 시뮬레이션 시작 양식(#58 버튼 진입)이 쓰는 값. 양식이 열릴 때마다 다시 읽어 플롯·세계관에서 고친 것을 따른다.
 * - 인물 후보: 이 작품에 연결된 WorldStudio 세계관의 인물 카드(내 세계관 목록에서 linkedWorkId가 이 작품인 것을 읽는다).
 *   서버가 characterIds를 연결 세계관의 활성 인물 카드 id로 검증하므로 레거시 설정집이나 장면 계획의 인물 id는 쓰지 않는다.
 *   연결한 세계관이 없는 Fork는 원작 세계관을 읽기 전용으로 이어받는다(#365): 소유하지 않은 세계관이라 내 세계관 읽기가 아니라
 *   서버가 공개 카드·Fork 기준 회차로 거른 이어받은 카드를 받고, 서버도 같은 카드 집합으로 characterIds를 검증한다.
 * - 흐름 비트: 열린 회차의 장면 계획(기존 StoryPlanUseCase). 참여 인물은 그 비트 문장에 이름이 나오는 카드를 미리 고른다.
 */
export function useSimulationSetupViewModel(workId: string, episode: number | null, plansVersion = 0) {
  const plans = appContainer.resolve('storyPlanUseCase')
  const worlds = appContainer.resolve('worldStudioUseCase')
  const episodes = appContainer.resolve('episodeUseCase')
  const { data, isLoading, isRefreshing, isError, retry } = useAsyncData(async (signal) => {
    const [list, owned] = await Promise.all([plans.list(workId, signal), worlds.list(signal)])
    const linked = owned.find((world) => world.linkedWorkId === workId)
    // 상한은 지금 여는 회차다. 서버가 Fork 기준 회차를 넘지 않게 자르고 AI 요청의 근거 회차도 같은 규칙으로 잘려, 후보와 서버 검증이 같은 카드 집합이 된다.
    const inherited = linked ? null : await episodes.inheritedWorld(workId, episode ?? undefined, signal)
    const characters = linked ? worldCharacters((await worlds.read(linked.id, signal)).settings) : inherited ? inheritedCharacters(inherited.cards, inherited.identity) : []
    const beats = planBeats(list, episode)
    return { plansVersion, linked: !!linked, inheritedUpto: inherited?.upto ?? null, characters, beats, characterIds: beatCharacterIds(beats, characters) }
  }, [plans, worlds, episodes, workId, episode], [plansVersion])
  return { ready: data, loading: isLoading, refreshing: isRefreshing || !!data && data.plansVersion !== plansVersion, failed: isError, retry }
}

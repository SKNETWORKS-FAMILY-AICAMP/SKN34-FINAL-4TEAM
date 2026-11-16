import { appContainer } from '../../../app/appContainer'
import { beatCharacterIds, planBeats, worldCharacters } from '../../../domain/entities/characterSimulation'
import { useAsyncData } from '../useAsyncData'

/**
 * 시뮬레이션 시작 양식(#58 버튼 진입)이 쓰는 값. 양식이 열릴 때마다 다시 읽어 플롯·세계관에서 고친 것을 따른다.
 * - 인물 후보: 이 작품에 연결된 WorldStudio 세계관의 인물 카드(내 세계관 목록에서 linkedWorkId가 이 작품인 것을 읽는다).
 *   서버가 characterIds를 연결 세계관의 활성 인물 카드 id로 검증하므로 레거시 설정집이나 장면 계획의 인물 id는 쓰지 않는다.
 * - 흐름 비트: 열린 회차의 장면 계획(기존 StoryPlanUseCase). 참여 인물은 그 비트 문장에 이름이 나오는 카드를 미리 고른다.
 */
export function useSimulationSetupViewModel(workId: string, episode: number | null) {
  const plans = appContainer.resolve('storyPlanUseCase')
  const worlds = appContainer.resolve('worldStudioUseCase')
  const { data, isLoading, isError, retry } = useAsyncData(async (signal) => {
    const [list, owned] = await Promise.all([plans.list(workId, signal), worlds.list(signal)])
    const linked = owned.find((world) => world.linkedWorkId === workId)
    const characters = linked ? worldCharacters((await worlds.read(linked.id, signal)).settings) : []
    const beats = planBeats(list, episode)
    return { linked: !!linked, characters, beats, characterIds: beatCharacterIds(beats, characters) }
  }, [plans, worlds, workId, episode])
  return { ready: data, loading: isLoading, failed: isError && !data, retry }
}

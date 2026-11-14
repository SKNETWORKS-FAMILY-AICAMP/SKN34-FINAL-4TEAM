import { appContainer } from '../../../app/appContainer'
import { planBeats, SIM_CHARACTERS_MAX } from '../../../domain/entities/characterSimulation'
import { useAsyncData } from '../useAsyncData'

/**
 * 시뮬레이션 시작 양식(#58 버튼 진입)이 쓰는 값: 연결 세계관의 인물 카드와, 열린 회차의 장면 계획에서 만든 흐름 비트·인물.
 * 기존 StoryPlanUseCase(장면 계획·인물 참조)를 그대로 쓰고, 양식이 열릴 때마다 다시 읽어 플롯에서 고친 계획을 따른다.
 * 장면 계획이 가리키는 인물 중 세계관에 없는 id(삭제된 카드)는 서버가 거절하므로 미리 고르지 않는다.
 */
export function useSimulationSetupViewModel(workId: string, episode: number | null) {
  const plans = appContainer.resolve('storyPlanUseCase')
  const { data, isLoading, isError, retry } = useAsyncData(async (signal) => {
    const [list, references] = await Promise.all([plans.list(workId, signal), plans.references(workId, signal)])
    const { beats, characterIds } = planBeats(list, episode)
    return {
      characters: references.characters,
      beats,
      characterIds: characterIds.filter((id) => references.characters.some((character) => character.id === id)).slice(0, SIM_CHARACTERS_MAX),
    }
  }, [plans, workId, episode])
  return { ready: data, loading: isLoading, failed: isError && !data, retry }
}

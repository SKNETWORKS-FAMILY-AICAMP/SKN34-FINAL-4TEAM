import { appContainer } from '../../../../app/appContainer'
import { chatBasis } from '../../../../domain/entities/writingChat'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 세계관 채팅의 근거: 연결된 소설의 가장 뒤 발행 회차. 소설이 없거나 읽지 못하면 null(채팅이 사유와 함께 잠긴다). */
export function useLinkedWorkBasis(linkedWorkId: string | null) {
  const episodes = useAsyncData((signal) => (linkedWorkId ? appContainer.resolve('episodeUseCase').writingList(linkedWorkId, signal) : Promise.resolve([])), [linkedWorkId])
  return episodes.data ? chatBasis(episodes.data) : null
}

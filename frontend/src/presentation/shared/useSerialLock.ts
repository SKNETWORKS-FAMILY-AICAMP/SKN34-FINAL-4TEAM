import { appContainer } from '../../app/appContainer'
import type { SerialUseCase } from '../../domain/usecases/SerialUseCase'
import { useAsyncData } from './useAsyncData'

/**
 * AI 자율 집필이 켜져 있는지(소유자 GET /works/{id}/ai-serial의 enabled)를 읽어 원고 수정 입력·버튼을 미리 잠그게 한다([계약](../../../../docs/design/ai-serial-contract.md)의 'AI 자율 집필 = 집필 방식': 켜져 있으면 1화만 쓴다).
 * locked는 '잠금이 걸려 있다'는 뜻이고 어느 회차를 잠글지는 호출 측이 domain의 serialEpisodeLocked·serialNewEpisodeLocked로 정한다.
 * 화면 잠금은 보조이고 판정은 서버(409 SERIAL_LOCKED)가 하므로, 읽는 중이거나 작품이 아직 없거나 읽기에 실패했으면(다시 읽다 실패해도 이전 값에 기대지 않는다) 잠그지 않고 서버에 맡긴다.
 * 운영 설정의 집필 방식을 저장하면(AI 자율 집필이 켜지고 꺼진다) reread로 서버 값을 다시 읽는다. 서버가 없는 시연(목업)에는 이 API가 없어 읽지 않는다.
 */
export function useSerialLock(workId: string | undefined, useCase: SerialUseCase = appContainer.resolve('serialUseCase')) {
  const mockup = import.meta.env.MODE === 'mockup'
  const read = useAsyncData((signal) => (workId && !mockup ? useCase.settings(workId, signal) : Promise.resolve(undefined)), [workId, useCase, mockup])
  return { locked: !read.isError && read.data?.enabled === true, reread: read.retry }
}

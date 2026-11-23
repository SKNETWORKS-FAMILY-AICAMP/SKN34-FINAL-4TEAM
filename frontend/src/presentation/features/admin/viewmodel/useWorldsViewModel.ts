import { appContainer } from '../../../../app/appContainer'
import type { OperationsWorld } from '../../../../domain/entities/operationsWorld'
import type { OperationsWorkUseCase } from '../../../../domain/usecases/OperationsWorkUseCase'
import type { OperationsWorldUseCase } from '../../../../domain/usecases/OperationsWorldUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

/**
 * 세계관 탭(결정 B): 지우지 않은 전체 세계관을 읽고 공개 경로 제한·해제를 요청합니다. 조치 키는 `world:<세계관 id>`입니다.
 * 연결 작품의 제목은 작품 목록에서 찾습니다. 작품 목록을 읽지 못해도 세계관 표는 그대로 쓰고 제목 자리에 '연결됨'만 보입니다.
 * 조회 권한(작품 관리)이 없으면 세계관 목록이 null이라 화면이 실패 대신 필요한 권한을 안내합니다.
 */
export function useWorldsViewModel(
  mutate: AdminMutate,
  useCase: OperationsWorldUseCase = appContainer.resolve('operationsWorldUseCase'),
  workUseCase: OperationsWorkUseCase = appContainer.resolve('operationsWorkUseCase'),
) {
  const worlds = useAsyncData(() => useCase.list(), [useCase])
  const works = useAsyncData(() => workUseCase.list(), [workUseCase])
  const titles = new Map((works.data ?? []).map((work) => [work.workId, work.title]))
  return {
    worlds,
    /** 연결 작품의 제목. 작품 목록을 아직 못 읽었거나 모르는 작품이면 undefined다. */
    workTitle: (workId: string) => titles.get(workId),
    restrict: (world: OperationsWorld, restricted: boolean) => mutate(
      `world:${world.worldId}`,
      restricted ? `「${world.name}」 세계관을 운영 제한했어요.` : `「${world.name}」 세계관의 운영 제한을 해제했어요.`,
      () => useCase.setRestriction(world.worldId, restricted),
    ),
  }
}

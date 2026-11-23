import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 운영자가 남의 작품 집필실을 열면 viewOnly(열람 전용)다. 서버도 운영자의 쓰기 요청은 소유자만 받는다(2026-11-23 사용자 결정).
 * 운영자는 소유자 확인이 끝나기 전(실패 포함)까지 열람 전용으로 두고, 일반 회원은 작품을 더 읽지 않는다.
 * 소유자를 알 수 없는 저장소(데모, null)는 열람 전용으로 만들지 않는다.
 * notice는 배너를 실제 결과와 맞춘다: 확인 중은 null(단정하지 않음), 확인한 남의 작품은 'others', 읽지 못했으면 'failed'(retry로 다시 확인).
 */
export function useOperatorViewOnly(id: string, reading: Pick<ReadingUseCase, 'ownerOf'> = appContainer.resolve('readingUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const memberId = useAppSelector((s) => s.session.memberId)
  const owner = useAsyncData(async () => (role === 'admin' ? reading.ownerOf(id) : null), [reading, id, role])
  const viewOnly = role === 'admin' && owner.data !== null && owner.data !== memberId
  const notice = !viewOnly ? null : owner.data !== undefined ? 'others' : owner.isError ? 'failed' : null
  return { viewOnly, notice, retry: owner.retry }
}

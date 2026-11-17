import { appContainer } from '../../../../app/appContainer'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { coverSrc } from '../../../shared/cover'
import { useAsyncData } from '../../../shared/useAsyncData'
import { useWorldCoverImage } from '../../../shared/useWorldCoverImage'

/** 내가 만드는 세계관 목록. 세계관 작업실이 쓰는 UseCase의 목록 조회를 그대로 쓴다(새 API 없음). */
export function useMyWorlds(api: Pick<WorldStudioUseCase, 'list'> = appContainer.resolve('worldStudioUseCase')) {
  const { data, isLoading, isError, retry } = useAsyncData((signal) => api.list(signal), [api])
  return { worlds: data ?? [], loading: isLoading, error: isError, reload: retry }
}

/**
 * 세계관 카드의 표지 주소. 올린 표지가 있으면(`hasCover`) 소유자 인증 읽기로 받은 이미지, 없거나 읽지 못하면 기본 표지다.
 * 읽는 동안은 빈 값이라(표지를 읽는 서재 작품 카드와 같게) 기본 표지에서 실제 표지로 바뀌며 깜빡이지 않는다.
 * 표지 저장소가 없는 데모(`supportsCover` false)는 읽지 않는다.
 */
export function useMyWorldCover(id: string, hasCover: boolean, api: Pick<WorldStudioUseCase, 'cover' | 'supportsCover'> = appContainer.resolve('worldStudioUseCase')) {
  const reads = hasCover && api.supportsCover
  const { url, error } = useWorldCoverImage(api, id, reads, 0)
  return reads && !url && !error ? '' : coverSrc(url)
}

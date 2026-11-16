import { appContainer } from '../../../../app/appContainer'
import { useAsyncData } from '../../../shared/useAsyncData'
import { importableWorlds } from '../../../shared/importCards'

/*
 * `다른 세계관에서 가져오기` 시트가 읽는 공개 세계관 조회. 서버에 가져오기 API는 없고 공개 조회 응답을 복사할 뿐이라 읽기만 한다(복사 규칙은 `importCards.ts`).
 */

/** 1단계: 가져올 수 있는 공개 세계관 목록(대상 세계관 자신은 뺀다). 불러오지 못하면 `worlds`가 없다. `shown`·`total`은 서버가 준 한 쪽의 개수와 전체 개수다. */
export function useImportableWorlds(targetId: string) {
  const { data, isLoading, retry } = useAsyncData((signal) => appContainer.resolve('publicWorldUseCase').list({}, signal), [])
  return { worlds: data && importableWorlds(data.items, targetId), shown: data?.items.length ?? 0, total: data?.total ?? 0, isLoading, retry }
}

/** 2단계: 고른 공개 세계관 한 건. 불러오지 못하면 `undefined`, 찾을 수 없으면(그사이 비공개가 됐거나 확정 버전이 없음) `null`이다. */
export function useImportSource(sourceId: string) {
  const { data: world, isLoading, retry } = useAsyncData((signal) => appContainer.resolve('publicWorldUseCase').get(sourceId, signal).then((found) => found ?? null), [sourceId])
  return { world, isLoading, retry }
}

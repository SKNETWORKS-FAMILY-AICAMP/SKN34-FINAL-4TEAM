import { useEffect, useRef, useState } from 'react'

import { useAppSelector } from '../../app/store'

type State<T> = { scope: readonly unknown[]; data: T | undefined; isError: boolean; isFetching: boolean }
const sameScope = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]))

/**
 * Repository 조회 공통 Hook. useCoreApiHealth와 같이 화면 이탈 시 늦은 응답을 버립니다(요청 ID).
 * 조회 범위(deps)·인증(role·계정)이 바뀌면 이전 원고를 즉시 감추고 새 요청 결과만 표시합니다.
 * 같은 범위에서 dataVersion이 오르거나 retry하면 이전 성공 데이터를 유지한 채 다시 조회하며(isRefreshing),
 * 재조회가 실패해도 그 데이터는 남기고 isError로 알립니다.
 */
export function useAsyncData<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const dataVersion = useAppSelector((s) => s.session.dataVersion)
  const role = useAppSelector((s) => s.session.role)
  const identity = useAppSelector((s) => s.session.user.email)
  const requestId = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State<T>>()
  const scope = [...deps, role, identity]
  const shown = state && sameScope(state.scope, scope) ? state : undefined

  useEffect(() => {
    const id = ++requestId.current
    const update = (patch: Partial<State<T>>) => setState((s) => ({
      ...(s && sameScope(s.scope, scope) ? s : { data: undefined, isError: false, isFetching: true }), scope, ...patch,
    }))
    update({ isError: false, isFetching: true })
    Promise.resolve().then(load).then(
      (data) => { if (requestId.current === id) update({ data, isError: false, isFetching: false }) },
      () => { if (requestId.current === id) update({ isError: true, isFetching: false }) },
    )
    return () => { requestId.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 호출자가 deps를 명시합니다.
  }, [...deps, dataVersion, attempt, role, identity])

  return {
    data: shown?.data, isLoading: !shown || (shown.data === undefined && shown.isFetching),
    isRefreshing: shown?.data !== undefined && shown.isFetching, isError: shown?.isError ?? false,
    retry: () => setAttempt((value) => value + 1),
  }
}

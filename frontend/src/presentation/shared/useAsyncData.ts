import { useEffect, useRef, useState } from 'react'

import { useAppSelector } from '../../app/store'

/**
 * Repository 조회 공통 Hook. useCoreApiHealth와 같이 화면 이탈 시 늦은 응답을 버리고(요청 ID),
 * dataVersion이 오르면(데이터 변경) 이전 값을 유지한 채 다시 조회합니다.
 */
export function useAsyncData<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const dataVersion = useAppSelector((s) => s.session.dataVersion)
  const requestId = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ data: T | undefined; isError: boolean; isFetching: boolean }>({ data: undefined, isError: false, isFetching: true })

  useEffect(() => {
    const id = ++requestId.current
    setState((s) => ({ ...s, isError: false, isFetching: true }))
    Promise.resolve().then(load).then(
      (data) => { if (requestId.current === id) setState({ data, isError: false, isFetching: false }) },
      () => { if (requestId.current === id) setState((s) => ({ ...s, isError: true, isFetching: false })) },
    )
    return () => { requestId.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 호출자가 deps를 명시합니다.
  }, [...deps, dataVersion, attempt])

  return {
    data: state.data, isLoading: state.data === undefined && state.isFetching,
    isRefreshing: state.data !== undefined && state.isFetching, isError: state.isError,
    retry: () => setAttempt((value) => value + 1),
  }
}

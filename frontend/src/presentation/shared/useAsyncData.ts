import { useEffect, useRef, useState } from 'react'

import { useAppSelector } from '../../app/store'

/**
 * Repository 조회 공통 Hook. useCoreApiHealth와 같이 화면 이탈 시 늦은 응답을 버리고(요청 ID),
 * dataVersion이 오르면(데이터 변경) 이전 값을 유지한 채 다시 조회합니다.
 */
export function useAsyncData<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const dataVersion = useAppSelector((s) => s.session.dataVersion)
  const requestId = useRef(0)
  const [state, setState] = useState<{ data: T | undefined; isError: boolean }>({ data: undefined, isError: false })

  useEffect(() => {
    const id = ++requestId.current
    load().then(
      (data) => { if (requestId.current === id) setState({ data, isError: false }) },
      () => { if (requestId.current === id) setState((s) => ({ ...s, isError: true })) },
    )
    return () => { requestId.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 호출자가 deps를 명시합니다.
  }, [...deps, dataVersion])

  return { data: state.data, isLoading: state.data === undefined && !state.isError, isError: state.isError }
}

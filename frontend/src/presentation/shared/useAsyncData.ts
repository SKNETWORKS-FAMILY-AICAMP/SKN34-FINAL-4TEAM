import { useEffect, useRef, useState } from 'react'

import { useAppSelector } from '../../app/store'

/**
 * Repository 조회 공통 Hook. useCoreApiHealth와 같이 화면 이탈 시 늦은 응답을 버리고(요청 ID),
 * 인증·조회 범위가 바뀌면 이전 원고를 즉시 감추고 새 요청 결과만 표시합니다.
 */
export function useAsyncData<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const dataVersion = useAppSelector((s) => s.session.dataVersion)
  const role = useAppSelector((s) => s.session.role)
  const identity = useAppSelector((s) => s.session.user.email)
  const requestId = useRef(0)
  const [retryVersion, setRetryVersion] = useState(0)
  const [state, setState] = useState<{ key: readonly unknown[]; data: T | undefined; isError: boolean }>()
  const key = [...deps, dataVersion, retryVersion, role, identity]
  const shown = state?.key.length === key.length && state.key.every((value,i)=>Object.is(value,key[i])) ? state : undefined

  useEffect(() => {
    const id = ++requestId.current
    load().then(
      (data) => { if (requestId.current === id) setState({ key, data, isError: false }) },
      () => { if (requestId.current === id) setState({ key, data: undefined, isError: true }) },
    )
    return () => { requestId.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 호출자가 deps를 명시합니다.
  }, [...deps, dataVersion, retryVersion, role, identity])

  return { data: shown?.data, isLoading: !shown, isError: shown?.isError ?? false, retry: () => setRetryVersion(v=>v+1) }
}

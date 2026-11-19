import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { appContainer } from '../../app/appContainer'
import { useAppSelector } from '../../app/store'
import { mcpChange } from '../../domain/entities/notification'
import type { ShellUseCase } from '../../domain/usecases/ShellUseCase'

type Watch = {
  targetType: 'work' | 'world'
  targetId: string
  /** 저장하지 않은 수정이 있으면 덮어쓰지 않고 배너로만 알립니다. */
  dirty: boolean
  /** 서버 값으로 다시 읽습니다. 읽었으면 true, 읽지 못했으면(진행 중인 저장·읽기 실패) false입니다. */
  reload: () => Promise<boolean>
}

/**
 * AI·외부 도구(MCP)가 지금 열어 둔 작품·세계관을 바꿨는지 알림 신호로 알아차려 화면을 다시 불러옵니다(#553, 계약: docs/design/mcp-change-notice-contract.md).
 * 알림 스트림 신호(noticeVersion)마다 최근 알림 한 쪽을 읽어, 열린 대상의 `ai-tool` 알림 시각이 기준선(화면을 열 때 처음 읽은 값, 그다음은 마지막으로 처리한 값)보다 뒤면 변경이다.
 * 저장하지 않은 수정이 없으면 바로 다시 불러오고, 있으면 덮지 않고 `stale`(배너)만 켠다. 배너의 `reload`는 확인 없이 서버 값으로 바꾼다.
 * 알림 조회 실패는 화면 오류로 만들지 않고 다음 신호까지 기다린다. 로그아웃·대상 변경·화면 이탈 때는 조회를 취소하고 늦은 응답을 버린다.
 * mockup(데모)에는 서버 알림이 없어 붙이지 않는다.
 */
export function useMcpChangeWatch(watch: Watch, shellUseCase: ShellUseCase = appContainer.resolve('shellUseCase')) {
  const { targetType, targetId } = watch
  const noticeVersion = useAppSelector((s) => s.session.noticeVersion)
  const account = useAppSelector((s) => (s.session.role ? s.session.user.email : null))
  const enabled = !!account && !!targetId && import.meta.env.MODE !== 'mockup'
  const [stale, setStale] = useState(false)
  /** undefined=아직 읽지 않음, null=읽었지만 열린 대상의 알림이 없음. 서버가 준 createdAt 그대로 둡니다. */
  const baseline = useRef<string | null | undefined>(undefined)
  // 늦게 끝나는 조회·다시 읽기가 렌더 시점이 아니라 지금의 입력 상태·다시 읽기 함수를 보게 합니다.
  const latest = useRef(watch)
  useLayoutEffect(() => { latest.current = watch })
  const reloading = useRef(false)
  const again = useRef(false)

  /** 서버 값으로 다시 읽습니다. 읽는 동안 또 바뀌면 한 번 더 읽어 연속 저장의 마지막 값을 놓치지 않고, 읽지 못하면 배너로 알립니다. */
  const sync = useCallback(async () => {
    if (reloading.current) { again.current = true; return }
    reloading.current = true
    try {
      do {
        again.current = false
        setStale(!(await latest.current.reload()))
      } while (again.current)
    } finally { reloading.current = false }
  }, [])

  // 대상이나 계정이 바뀌면 기준선과 배너를 비웁니다(새 대상은 처음 읽은 값이 기준선이 됩니다).
  useEffect(() => () => { baseline.current = undefined; setStale(false) }, [account, targetType, targetId])
  useEffect(() => {
    if (!enabled) return
    const request = new AbortController()
    shellUseCase.listNotifications(null, request.signal).then(
      (page) => {
        if (request.signal.aborted) return
        const next = mcpChange(page.items, { targetType, targetId }, baseline.current)
        baseline.current = next.baseline
        if (!next.changed) return
        if (latest.current.dirty) setStale(true)
        else void sync()
      },
      () => {},
    )
    return () => request.abort()
  }, [noticeVersion, enabled, targetType, targetId, shellUseCase, sync])

  return { stale, reload: sync }
}

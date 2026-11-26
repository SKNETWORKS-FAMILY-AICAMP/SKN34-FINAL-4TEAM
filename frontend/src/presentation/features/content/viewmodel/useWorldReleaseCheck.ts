import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'

/** 연결을 풀기 직전에 공개 상태를 확인한다. 조회 실패는 확인되지 않은 상태로 전달한다. */
export function useWorldReleaseCheck(
  worldId: string | null | undefined,
  worlds: Pick<WorldStudioUseCase, 'list'> = appContainer.resolve('worldStudioUseCase'),
) {
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [warning, setWarning] = useState<{ id: string; world?: StudioWorld } | null>(null)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => {
    request.current?.abort()
    request.current = null
  }, [worldId])

  const check = async (proceed: () => void) => {
    if (request.current) return
    if (!worldId) return proceed()
    const controller = new AbortController()
    request.current = controller
    setCheckingId(worldId)
    const fresh = await worlds.list(controller.signal).then((rows) => rows.find((w) => w.id === worldId), () => undefined)
    if (controller.signal.aborted) return
    request.current = null
    setCheckingId(null)
    if (fresh && fresh.visibility !== 'public') proceed()
    else setWarning({ id: worldId, world: fresh })
  }

  return {
    check,
    checking: checkingId !== null && checkingId === worldId && !!request.current,
    warning: warning?.id === worldId ? warning : null,
    close: () => setWarning(null),
  }
}

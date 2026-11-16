import { useCallback, useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { WorldCheckpoint, WorldCheckpointSummary } from '../../../../domain/entities/content'

export function useWorldCheckpointViewModel(workId: string) {
  const api = appContainer.resolve('episodeUseCase')
  const [rows, setRows] = useState<WorldCheckpointSummary[] | null>(null)
  const [detail, setDetail] = useState<WorldCheckpoint | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef<AbortController | null>(null)
  const run = useCallback(async (action: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action(controller.signal)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '체크포인트 요청을 처리하지 못했어요.')
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setBusy(false)
      }
    }
  }, [])
  const reload = useCallback(() => run(async signal => {
    const result = await api.worldCheckpoints(workId, signal)
    if (!signal.aborted) setRows(result)
  }), [api, workId, run])
  useEffect(() => {
    void reload()
    return () => { pending.current?.abort(); pending.current = null }
  }, [reload])
  return {
    rows, detail, busy, error, notice, reload,
    // 열려 있는 체크포인트를 다시 누르면 상세를 닫고, 다른 항목이면 상세를 읽어 온다.
    toggle: (id: string) => detail?.id === id ? setDetail(null) : run(async signal => {
      const result = await api.worldCheckpoint(workId, id, signal)
      if (!signal.aborted) setDetail(result)
    }),
    create: () => run(async signal => {
      const result = await api.createWorldCheckpoint(workId, signal)
      if (signal.aborted) return
      setRows(current => [{ id: result.id, createdAt: result.createdAt }, ...(current ?? [])])
      setDetail(result)
      setNotice('세계관 체크포인트를 저장했어요.')
    }),
  }
}

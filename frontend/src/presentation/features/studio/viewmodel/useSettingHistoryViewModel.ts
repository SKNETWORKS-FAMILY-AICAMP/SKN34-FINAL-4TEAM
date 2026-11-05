import { useCallback, useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { World } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

type HistoryApi = Pick<EpisodeUseCase, 'world' | 'revertSetting'>
export function useSettingHistoryViewModel(workId: string, api: HistoryApi = appContainer.resolve('episodeUseCase')) {
  const [world, setWorld] = useState<World | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef<AbortController | null>(null)
  const execute = useCallback(async (action: (signal: AbortSignal) => Promise<World>, message: string) => {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await action(controller.signal)
      if (!controller.signal.aborted) { setWorld(result); setNotice(message) }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '설정 이력을 불러오지 못했어요. 다시 시도해 주세요.')
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false) }
    }
  }, [])
  const reload = useCallback(() => execute(signal => api.world(workId, signal), ''), [execute, api, workId])
  useEffect(() => {
    setWorld(null)
    void reload()
    return () => { pending.current?.abort(); pending.current = null }
  }, [reload])
  return { world, busy, error, notice, reload,
    restore: (id: string, versionId: string) => {
      if (!world || world.drafts.length || world.draft || !world.history.some(s => s.id === id && s.versionId === versionId && s.content)) return
      return execute(signal => api.revertSetting(workId, id, world.revision, versionId, signal), '과거 설정을 새 버전으로 복원했어요.')
    },
  }
}

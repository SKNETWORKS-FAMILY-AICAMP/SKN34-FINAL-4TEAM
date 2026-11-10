import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { Work } from '../../../../domain/entities/content'

export function useForkManagement(works: Work[], reload: () => void) {
  const api = appContainer.resolve('episodeUseCase')
  const pending = useRef<AbortController | null>(null)
  const [forkOnly, setForkOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => () => pending.current?.abort(), [])

  async function run(action: (signal: AbortSignal) => Promise<unknown>, message: string) {
    if (pending.current) return
    const request = new AbortController()
    pending.current = request
    setBusy(true); setNotice(''); setError('')
    try {
      await action(request.signal)
      if (!request.signal.aborted) { setNotice(message); reload() }
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : '포크 변경에 실패했어요.')
    } finally {
      pending.current = null
      if (!request.signal.aborted) setBusy(false)
    }
  }

  return { busy, notice, error, forkOnly, setForkOnly, works: forkOnly ? works.filter(work => work.source !== null) : works,
    update: (work: Work, title: string, summary: string) => {
      const revision = work.revision
      if (revision !== undefined) return run(signal => api.updateWork(work.id, title, summary, revision, signal), '포크 기본 정보를 저장했어요.')
    },
    stop: (id: string) => {
      if (window.confirm('포크 작품의 공개를 중단할까요? 발행된 회차와 원고는 보존돼요.'))
        return run(signal => api.stopForkPublication(id, signal), '포크 공개를 중단했어요.')
    },
    remove: (id: string) => {
      if (window.confirm('포크를 삭제할까요? 서재와 공개 화면에서 숨겨져요.'))
        return run(signal => api.deleteWork(id, signal), '포크를 삭제했어요.')
    },
  }
}

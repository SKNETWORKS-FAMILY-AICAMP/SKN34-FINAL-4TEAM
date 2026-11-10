import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { Work } from '../../../../domain/entities/content'

export function useForkManagement(works: Work[], reload: () => void) {
  const api = appContainer.resolve('episodeUseCase')
  const pending = useRef<AbortController | null>(null)
  const resultRef = useRef<HTMLParagraphElement>(null)
  const [forkOnly, setForkOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => () => pending.current?.abort(), [])
  // 동작을 누른 버튼은 요청 동안 잠기고 삭제·공개 중단 뒤에는 사라지므로, 결과 문구로 포커스를 옮겨 위치를 잃지 않게 한다.
  useEffect(() => { if (notice || error) resultRef.current?.focus() }, [notice, error])

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

  return { busy, notice, error, resultRef, forkOnly, setForkOnly, works: forkOnly ? works.filter(work => work.source !== null) : works,
    update: (work: Work, title: string, summary: string) => {
      const revision = work.revision
      if (revision !== undefined) return run(signal => api.updateWork(work.id, title, summary, revision, signal), '포크 기본 정보를 저장했어요.')
    },
    stop: (id: string) => {
      if (window.confirm('포크 작품의 공개를 중단할까요? 발행된 회차와 원고는 보존돼요. 대기 중인 예약 발행은 취소되고, 원작이 공개를 허용하지 않으면 다시 공개할 수 없어요.'))
        return run(signal => api.stopForkPublication(id, signal), '포크 공개를 중단했어요.')
    },
    remove: (work: Work) => {
      if (window.confirm(`「${work.title}」 포크를 삭제할까요? 서재와 공개 화면에서 숨겨지고 되돌릴 수 없어요. 같은 원작에서 포크를 다시 만들 수 없어요.`))
        return run(signal => api.deleteWork(work.id, signal), '포크를 삭제했어요.')
    },
  }
}

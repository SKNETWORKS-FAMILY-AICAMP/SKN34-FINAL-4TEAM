import { useCallback, useEffect, useState } from 'react'

import { appContainer } from '../../../app/appContainer'

type Draft = { body: string; revision: number }
type Loaded = { key: string; draft: Draft | null }

/**
 * 부분 수정 구간 고르기(#497)가 보여 줄 반영 회차의 작업 초안. episode가 null이면 읽지 않는다(`idle`).
 * 읽는 중·실패는 실제 결과대로 알리고(`loading`·`failed`) 실패를 빈 초안으로 바꾸지 않는다. retry로 다시 읽는다.
 */
export function useEpisodeDraft(workId: string, episode: number | null) {
  const episodes = appContainer.resolve('episodeUseCase')
  const key = `${workId}/${episode}`
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded>()
  useEffect(() => {
    if (episode === null) return
    const controller = new AbortController()
    episodes.writingEpisode(workId, episode, controller.signal).then(
      (e) => setLoaded({ key, draft: { body: e.draft.body, revision: e.draft.revision } }),
      () => { if (!controller.signal.aborted) setLoaded({ key, draft: null }) },
    )
    return () => controller.abort()
  }, [episodes, workId, episode, key, attempt])
  const retry = useCallback(() => { setLoaded(undefined); setAttempt((n) => n + 1) }, [])
  const status = episode === null ? 'idle' : loaded?.key !== key ? 'loading' : loaded.draft ? 'ready' : 'failed'
  return { status, draft: loaded?.key === key ? loaded.draft : null, retry } as const
}

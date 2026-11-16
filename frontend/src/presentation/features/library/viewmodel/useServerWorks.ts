import { useEffect, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { Work } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

export function useServerWorks(api: Pick<EpisodeUseCase, 'list'> = appContainer.resolve('episodeUseCase')) {
  const [works, setWorks] = useState<Work[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [request, setRequest] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    // 다시 불러오는 동안에는 기존 목록을 그대로 둔다. 처음 불러올 때만 비어 있다.
    api.list(controller.signal).then(rows => {
      if (!controller.signal.aborted) setWorks(rows)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '작품을 불러오지 못했어요.')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [api, request])
  return { works, loading, error, reload: () => setRequest(value => value + 1) }
}

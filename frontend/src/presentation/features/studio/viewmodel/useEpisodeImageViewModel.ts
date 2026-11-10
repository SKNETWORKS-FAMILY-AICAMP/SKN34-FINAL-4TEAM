import { useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { Draft } from '../../../../domain/entities/content'
import { removeImageMarker, type EpisodeImage } from '../../../../domain/entities/media'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import type { MediaUseCase } from '../../../../domain/usecases/MediaUseCase'

type Props = {
  workId: string
  episode: number
  draft: Draft
  /** 저장하지 않은 입력이 있거나 저장 중이면 true. 이때는 초안을 덮어쓰지 않는다. */
  unsaved: boolean
  /** 본문에서 뺀 초안이 서버에 저장되면 집필실이 최신 초안을 다시 읽도록 알린다. */
  onDraftSaved: () => void
}

/** 집필실 회차 이미지: 목록·대체 텍스트 저장·본문에서 빼기. 이미지 파일은 저장 버전·발행본이 참조할 수 있어 지우지 않는다. */
export function useEpisodeImageViewModel(
  { workId, episode, draft, unsaved, onDraftSaved }: Props,
  media: Pick<MediaUseCase, 'listEpisodeImages' | 'updateEpisodeImageAlt'> = appContainer.resolve('mediaUseCase'),
  episodes: Pick<EpisodeUseCase, 'writeEpisode'> = appContainer.resolve('episodeUseCase'),
) {
  const scope = `${workId}:${episode}`
  const [loaded, setLoaded] = useState<{ scope: string; images: EpisodeImage[] }>({ scope: '', images: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  const pending = useRef<AbortController | null>(null)
  // 회차가 바뀌면 이전 회차의 이미지를 감추고, 같은 회차의 재조회(초안 저장·새로고침)는 이전 목록을 둔 채 갱신한다.
  const images = loaded.scope === scope ? loaded.images : []
  const loading = loaded.scope !== scope && !error
  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    media.listEpisodeImages(workId, episode, controller.signal)
      .then((rows) => { if (!controller.signal.aborted) setLoaded({ scope, images: rows }) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '이미지 목록을 불러오지 못했어요.') })
    return () => controller.abort()
  }, [workId, episode, scope, draft.revision, attempt, media])

  const run = async (action: (signal: AbortSignal) => Promise<void>, hint = '') => {
    if (pending.current) return false
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action(controller.signal)
      return !controller.signal.aborted
    } catch (cause) {
      if (!controller.signal.aborted) setError(`${cause instanceof Error ? cause.message : '요청을 처리하지 못했어요.'}${hint}`)
      return false
    } finally {
      if (pending.current === controller) {
        pending.current = null
        if (!controller.signal.aborted) setBusy(false)
      }
    }
  }
  const patch = (id: string, change: Partial<EpisodeImage>) => setLoaded((current) => ({ ...current, images: current.images.map((image) => image.id === id ? { ...image, ...change } : image) }))

  return {
    images, loading, busy, error, notice,
    reload: () => setAttempt((value) => value + 1),
    saveAlt: (image: EpisodeImage, altText: string) => run(async (signal) => {
      const updated = await media.updateEpisodeImageAlt(workId, episode, image.id, altText, signal)
      if (signal.aborted) return
      patch(image.id, updated)
      setNotice('이미지 설명을 저장했어요.')
    }),
    removeFromBody: async (image: EpisodeImage) => {
      if (unsaved) {
        setNotice('')
        setError('저장하지 않은 입력이 있거나 저장 중이에요. 저장이 끝난 뒤에 본문에서 뺄 수 있어요.')
        return false
      }
      return run(async (signal) => {
        const body = removeImageMarker(draft.body, image.id)
        if (body === draft.body) {
          patch(image.id, { referenced: false })
          setNotice('이 이미지는 이미 본문에 없어요.')
          return
        }
        await episodes.writeEpisode(workId, episode, { title: draft.title, body, revision: draft.revision }, false, signal)
        if (signal.aborted) return
        patch(image.id, { referenced: false })
        setNotice('본문에서 뺐어요. 이미지 파일은 저장 버전·발행본을 위해 남겨 두었어요.')
        onDraftSaved()
      }, ' 원고가 다른 곳에서 바뀌었을 수 있어요. 집필실에서 다시 불러온 뒤 시도해 주세요. 입력한 이미지 설명은 그대로 남겨 두었어요.')
    },
  }
}

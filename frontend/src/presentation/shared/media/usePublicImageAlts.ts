import { useEffect, useState } from 'react'

import { appContainer } from '../../../app/appContainer'
import type { MediaUseCase } from '../../../domain/usecases/MediaUseCase'

/**
 * 공개 작품 발행본이 참조하는 이미지의 대체 텍스트(이미지 ID → 설명). `enabled`가 아니면 요청하지 않는다.
 * 불러오지 못하면 빈 값이라 호출한 화면은 기존 대체 문구를 쓴다.
 */
export function usePublicImageAlts(workId: string, number: number, enabled: boolean, api: Pick<MediaUseCase, 'publicEpisodeImageAlts'> = appContainer.resolve('mediaUseCase')) {
  const [alts, setAlts] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    api.publicEpisodeImageAlts(workId, number, controller.signal)
      .then((rows) => { if (!controller.signal.aborted) setAlts(rows) })
      .catch(() => { /* 설명을 못 불러와도 이미지는 기존 대체 문구로 보여 준다. */ })
    return () => controller.abort()
  }, [workId, number, enabled, api])
  return alts
}

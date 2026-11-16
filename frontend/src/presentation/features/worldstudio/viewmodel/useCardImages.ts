import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { WORLD_COVER_TYPES } from '../../../../domain/entities/studioWorld'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'

/** `made`는 객체 주소를 만든 순간 채워져, 떠날 때 기다리지 않고 바로 해제한다(아직 읽는 중이면 끊긴 요청이 주소를 만들지 않는다). */
type Entry = { controller: AbortController; url: Promise<string>; made: { url?: string } }

/**
 * 소유자 화면의 설정 카드 이미지(#401): 인증이 필요한 읽기(Bearer)로 받은 이미지를 객체 주소로 바꿔 돌려준다(공개 화면은 공개 주소를 `<img>`로 직접 쓴다).
 * 올린 이미지는 바뀌지 않아 이미지 id가 곧 내용이다. 그래서 게시판·레일·편집 화면이 같은 id를 몇 번 그려도 한 번만 읽고 같은 주소를 나눠 쓴다(응답이 `no-store`라 브라우저 캐시는 기대하지 않는다).
 * 읽지 못한 것은 남기지 않아 다시 부르면 다시 읽는다. 세계관이 바뀌거나 화면을 떠나면 읽던 요청을 끊고 만든 객체 주소를 모두 해제한다.
 * ponytail: 이 세계관 화면이 열려 있는 동안은 읽은 이미지를 모두 메모리에 둔다(카드 수만큼, 작은 이미지 기준). 아주 많아지면 보이는 줄만 읽는 쪽으로 바꾼다.
 */
export function useCardImages(useCase: Pick<WorldStudioUseCase, 'supportsCardImages' | 'cardImage'>, worldId: string | undefined) {
  const entries = useRef(new Map<string, Entry>())
  /** 카드가 다른 이미지로 바뀌거나 이미지를 뺐을 때 이전 이미지의 객체 주소를 바로 해제한다(그 카드를 그리던 곳은 새 이미지를 받는다). */
  const release = useCallback((imageId: string) => {
    const found = entries.current.get(imageId)
    if (!found) return
    found.controller.abort()
    if (found.made.url) URL.revokeObjectURL(found.made.url)
    entries.current.delete(imageId)
  }, [])
  useEffect(() => () => entries.current.forEach((_, imageId) => release(imageId)), [useCase, worldId, release])
  const load = useCallback((imageId: string): Promise<string> => {
    const found = entries.current.get(imageId)
    if (found) return found.url
    const controller = new AbortController(), made: Entry['made'] = {}
    const url = (async () => {
      if (!worldId) throw new Error('이미지를 불러올 세계관이 없어요.')
      const blob = await useCase.cardImage(worldId, imageId, controller.signal)
      if (!(WORLD_COVER_TYPES as readonly string[]).includes(blob.type)) throw new Error('안전한 이미지 응답을 확인할 수 없어요.')
      if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError')
      return (made.url = URL.createObjectURL(blob))
    })()
    entries.current.set(imageId, { controller, url, made })
    url.catch(() => { if (entries.current.get(imageId)?.url === url) entries.current.delete(imageId) })
    return url
  }, [useCase, worldId])
  const supported = !!worldId && useCase.supportsCardImages
  return useMemo(() => ({ supported, load, release }), [supported, load, release])
}
export type CardImages = ReturnType<typeof useCardImages>

/** 한 이미지의 객체 주소. 읽는 중이면 `pending`, 읽지 못하면 `error`에 이유가 있고(url은 빔), 이미지 id가 없거나 읽을 수 없는 저장소(데모)면 셋 다 비어 있다. */
export function useCardImageUrl(images: CardImages, imageId: string | undefined) {
  const [state, setState] = useState({ imageId: '', url: '', error: '' })
  useEffect(() => {
    if (!imageId || !images.supported) return
    let current = true
    images.load(imageId).then(
      (url) => { if (current) setState({ imageId, url, error: '' }) },
      (e: unknown) => { if (current) setState({ imageId, url: '', error: e instanceof Error ? e.message : '이미지를 불러오지 못했어요.' }) },
    )
    return () => { current = false }
  }, [images, imageId])
  const { url, error } = state.imageId === imageId ? state : { url: '', error: '' } // 다른 이미지의 결과가 남아 보이지 않게 한다
  return { url, error, pending: !!imageId && images.supported && !url && !error }
}

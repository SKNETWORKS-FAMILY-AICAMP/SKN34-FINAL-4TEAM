import { useEffect, useState } from 'react'

import { WORLD_COVER_TYPES } from '../../../../domain/entities/studioWorld'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'

/**
 * 소유자 화면의 세계관 표지: 인증이 필요한 읽기(Bearer)로 받은 이미지를 객체 주소로 바꿔 돌려준다(공개 화면은 공개 cover 주소를 `<img>`로 직접 쓴다).
 * 표지가 없거나(`enabled` false) 읽는 중·실패면 `url`이 비어 화면이 자동 생성 표지를 쓴다. `revision`이 바뀌면(올림·교체) 다시 읽고, 바뀌거나 사라질 때 이전 객체 주소를 해제한다.
 */
export function useWorldCoverImage(useCase: Pick<WorldStudioUseCase, 'cover'>, worldId: string | undefined, enabled: boolean, revision: number) {
  const [state, setState] = useState({ url: '', error: '' })
  useEffect(() => {
    if (!worldId || !enabled) {
      setState({ url: '', error: '' })
      return
    }
    const controller = new AbortController()
    let url = ''
    setState({ url: '', error: '' })
    useCase.cover(worldId, controller.signal).then((blob) => {
      if (controller.signal.aborted) return
      if (!(WORLD_COVER_TYPES as readonly string[]).includes(blob.type)) throw new Error('안전한 이미지 응답을 확인할 수 없어요.')
      url = URL.createObjectURL(blob)
      setState({ url, error: '' })
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setState({ url: '', error: e instanceof Error ? e.message : '표지를 불러오지 못했어요.' })
    })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [useCase, worldId, enabled, revision])
  return state
}

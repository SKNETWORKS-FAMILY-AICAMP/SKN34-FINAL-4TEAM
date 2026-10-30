import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'
import { useLook } from './useLook'

/** 목업 work(id): 소설 상세 U04 */
export function useWorkViewModel(id: string, readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase')) {
  const { role, epSort } = useAppSelector((s) => s.session)
  const dispatch = useAppDispatch()
  const look = useLook()
  const { data } = useAsyncData(() => readingUseCase.getWork(id, role), [readingUseCase, id, role])
  const [query, setQuery] = useState('')
  const [reporting, setReporting] = useState(false)
  useScreenId(data ? 'U04' : null)

  const v = query.trim().toLowerCase()
  const ordered = data ? (epSort === 'new' ? data.visible.slice().reverse() : data.visible) : []
  const episodes = ordered.map(([e, i]) => ({ e, n: i + 1, match: !v || (i + 1 + '화 ' + e.t + ' ' + e.p.join(' ')).toLowerCase().includes(v) }))

  return {
    /** undefined: 불러오는 중, null: 없거나 볼 수 없는 작품 */
    detail: data,
    episodes,
    noMatch: episodes.length > 0 && !episodes.some((x) => x.match),
    query,
    setQuery,
    epSort,
    setSort: (s: 'old' | 'new') => dispatch(sessionActions.setEpSort(s)),
    bandAmb: !look.dark && look.eff === 'world' && look.motion,
    toggleLike: () => readingUseCase.toggleLike(id).then((on) => {
      dispatch(sessionActions.dataChanged())
      toast(on ? '관심 소설에 담았어요' : '관심 소설에서 뺐어요')
    }),
    share: () => toast('링크 공유는 데모예요 (실제 복사 없음)'),
    reporting,
    setReporting,
  }
}

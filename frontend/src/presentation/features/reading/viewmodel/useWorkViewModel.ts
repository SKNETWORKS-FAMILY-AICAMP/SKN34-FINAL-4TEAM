import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { canReport, isPub } from '../../../../domain/entities/work'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import type { WorkInterestUseCase } from '../../../../domain/usecases/WorkInterestUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { uiActions } from '../../../shared/ui/uiSlice'
import { useAsyncData } from '../../../shared/useAsyncData'
import { useLook } from './useLook'

/** 목업 work(id): 소설 상세 U04 */
export function useWorkViewModel(id: string, readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase'), interestUseCase: WorkInterestUseCase = appContainer.resolve('workInterestUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const memberId = useAppSelector((s) => s.session.memberId)
  const epSort = useAppSelector((s) => s.ui.epSort)
  const dispatch = useAppDispatch()
  const look = useLook()
  const { data, isError, retry } = useAsyncData(() => readingUseCase.getWork(id, role), [readingUseCase, id, role])
  const [query, setQuery] = useState('')
  const [reporting, setReporting] = useState(false)
  // 관심 작품(기능 21-B)은 좋아요와 별개다. 비회원은 서버를 부르지 않고(버튼은 로그인 링크), 회원은 서버의 관심 목록으로 상태를 안다.
  const workId = data?.work.id
  const interest = useAsyncData(() => (role && workId ? interestUseCase.isInterested(workId) : Promise.resolve(false)), [interestUseCase, workId])
  const [interestPending, setInterestPending] = useState(false)
  // 목업 render(): 다른 작품으로 옮기면 회차 검색어(#epq)를 비우고, 열린 신고 시트도 닫습니다(이전 작품용 신고가 새 작품에 접수되지 않게).
  const [shown, setShown] = useState(id)
  if (shown !== id) { setShown(id); setQuery(''); setReporting(false) }
  useScreenId(data ? 'U04' : null)

  const v = query.trim().toLowerCase()
  const ordered = data ? (epSort === 'new' ? data.visible.slice().reverse() : data.visible) : []
  const episodes = ordered.map(([e, i]) => ({ e, n: i + 1, match: !v || (i + 1 + '화 ' + e.t + ' ' + e.p.join(' ')).toLowerCase().includes(v) }))

  return {
    /** undefined: 불러오는 중, null: 없거나 볼 수 없는 작품 */
    detail: data, isError, retry,
    episodes,
    noMatch: episodes.length > 0 && !episodes.some((x) => x.match),
    query,
    setQuery,
    epSort,
    setSort: (s: 'old' | 'new') => dispatch(uiActions.setEpSort(s)),
    bandAmb: !look.dark && look.eff === 'world' && look.motion,
    /** 공개 작품에서만 관심 등록 버튼을 보입니다(서버도 공개 작품만 받습니다). */
    canInterest: !!data && isPub(data.work),
    isMember: !!role,
    /** 서버 상태를 모르는 동안(undefined)은 버튼을 잠급니다. */
    interested: interest.data,
    interestBusy: interestPending || interest.isLoading || interest.isRefreshing,
    toggleInterest: async () => {
      if (!workId || interestPending) return
      if (interest.data === undefined) { interest.retry(); toast('관심 상태를 다시 확인하고 있어요. 잠시 뒤 다시 눌러 주세요.'); return }
      const on = !interest.data
      setInterestPending(true)
      try {
        await interestUseCase.setInterested(workId, on)
        dispatch(sessionActions.dataChanged())
        toast(on ? '관심 소설에 담았어요' : '관심 소설에서 뺐어요')
      } catch (error) {
        toast(error instanceof Error ? error.message : '관심 작품을 바꾸지 못했어요.')
      } finally { setInterestPending(false) }
    },
    /** 비회원이 관심 등록을 누르면 로그인 후 이 작품으로 돌아오도록 안내를 남깁니다. 이동은 로그인 링크가 맡습니다. */
    requireLogin: () => { dispatch(sessionActions.requireLogin({ next: `/work/${id}`, msg: '관심 소설은 로그인한 뒤 담을 수 있어요.', role: 'user' })) },
    toggleLike: () => readingUseCase.toggleLike(data?.work.id ?? id).then((on) => {
      dispatch(sessionActions.dataChanged())
      toast(on ? '이 창의 관심 소설에 담았어요 · 계정에 저장되지 않아요' : '이 창의 관심 소설에서 뺐어요')
    }),
    share: () => toast('링크 공유는 데모예요 (실제 복사 없음)'),
    /** 남의 공개 작품에서만 신고 버튼을 보입니다. */
    canReport: !!data && canReport(data.work, memberId),
    reporting,
    setReporting,
  }
}

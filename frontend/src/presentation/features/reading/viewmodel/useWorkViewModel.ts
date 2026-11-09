import { useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { canReport } from '../../../../domain/entities/work'
import { SessionExpired } from '../../../../domain/repositories/ProfileRepository'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { uiActions } from '../../../shared/ui/uiSlice'
import { useAsyncData } from '../../../shared/useAsyncData'
import { useLook } from './useLook'

/** 목업 work(id): 소설 상세 U04 */
export function useWorkViewModel(id: string, readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const memberId = useAppSelector((s) => s.session.memberId)
  const epSort = useAppSelector((s) => s.ui.epSort)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const look = useLook()
  const { data, isError, retry } = useAsyncData(() => readingUseCase.getWork(id, role), [readingUseCase, id, role])
  const [query, setQuery] = useState('')
  const [reporting, setReporting] = useState(false)
  /** 좋아요 요청이 진행 중인 동안 다시 누르지 못하게 합니다. */
  const [liking, setLiking] = useState(false)
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
    likePending: liking,
    /**
     * 서버 작품은 회원의 좋아요를 Content에 보내고 결과를 다시 조회해 보입니다(낙관적 갱신 없음). 비로그인은 로그인 안내 후 이 작품으로
     * 돌아오게 하고, 실패는 안내 문구로 알립니다. 데모 작품은 기존처럼 이 창의 메모리 관심 소설에 담습니다.
     */
    toggleLike: async () => {
      if (!data || liking) return
      const { work, liked } = data
      if (work.canonical && !role) {
        dispatch(sessionActions.requireLogin({ next: `/work/${id}`, msg: '좋아요는 로그인한 회원만 누를 수 있어요.', role: 'user' }))
        navigate('/login')
        return
      }
      setLiking(true)
      try {
        const on = await readingUseCase.toggleLike(work.id, { canonical: work.canonical, liked })
        dispatch(sessionActions.dataChanged())
        toast(work.canonical ? (on ? '좋아요를 눌렀어요' : '좋아요를 취소했어요') : on ? '이 창의 관심 소설에 담았어요 · 계정에 저장되지 않아요' : '이 창의 관심 소설에서 뺐어요')
      } catch (error) {
        if (error instanceof SessionExpired) { dispatch(sessionActions.logout()); toast('세션이 만료됐어요. 다시 로그인해 주세요.') }
        else toast(error instanceof Error && error.message ? error.message : '좋아요를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.')
      } finally { setLiking(false) }
    },
    share: () => toast('링크 공유는 데모예요 (실제 복사 없음)'),
    /** 남의 공개 작품에서만 신고 버튼을 보입니다. */
    canReport: !!data && canReport(data.work, memberId),
    reporting,
    setReporting,
  }
}

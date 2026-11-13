import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import type { CommentSort, EpisodeComment } from '../../../../domain/entities/episodeComment'
import type { EpisodeCommentUseCase } from '../../../../domain/usecases/EpisodeCommentUseCase'
import { toast } from '../../../shared/events'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 실제 작품 회차 댓글(기능 22). 목록은 서버에서 정렬해 읽고, 쓰기는 한 번에 하나만 보낸 뒤 서버 값으로 다시 읽습니다.
 * 입력 검증은 UseCase가 하고, 입력 거절·서버 실패는 안내만 하며 입력은 호출 측이 그대로 둡니다.
 * 쓰기는 보낸 뒤 되돌릴 수 없어 화면을 떠나도 취소하지 않고 결과를 안내합니다.
 */
export function useEpisodeCommentsViewModel(workId: string, n: number, useCase: EpisodeCommentUseCase = appContainer.resolve('episodeCommentUseCase')) {
  const loggedIn = useAppSelector((s) => !!s.session.role)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const [sort, setSort] = useState<CommentSort>('latest')
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  // 정렬은 화면 선택이라 refresh에 둡니다(이전 목록을 유지한 채 다시 읽음). 회차가 바뀌면, 그리고 로그인·로그아웃하면
  // (useAsyncData가 role·계정을 범위에 포함) 목록을 감추고 다시 읽습니다. 늦은 응답도 useAsyncData가 버립니다.
  const { data, isError, retry } = useAsyncData(() => useCase.list(workId, n, sort), [useCase, workId, n], [sort])
  const requireLogin = () => { dispatch(sessionActions.requireLogin({ next: pathname + search, msg: '댓글 작성과 좋아요는 로그인한 회원만 할 수 있어요.', role: 'user' })) }

  /** 성공하면 true. 이미 보내는 중이면 무시하고, 입력 거절·서버 거절·네트워크 실패는 안내만 합니다(fail: 사유를 알릴 곳, 기본은 토스트). */
  const send = async (task: () => Promise<unknown>, done?: string, fail: (message: string) => void = toast) => {
    if (sending.current) return false
    sending.current = true
    setBusy(true)
    try {
      await task()
      retry() // 같은 범위에서 이전 목록을 유지한 채 서버 값으로 다시 읽습니다.
      if (done) toast(done)
      return true
    } catch (error) {
      fail(error instanceof Error ? error.message : '댓글 요청을 처리하지 못했어요.')
      return false
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return {
    /** undefined: 불러오는 중이거나 첫 조회 실패(isError) */
    comments: data,
    isError, retry,
    sort, setSort,
    loggedIn, busy,
    requireLogin,
    /** fail을 넘기면(문장 댓글 시트) 실패 사유를 토스트 대신 그리로 보냅니다. */
    create: async (body: string, quote: string | null, spoiler: boolean, fail?: (message: string) => void) => {
      // 문장 시트는 익명도 열 수 있어, 서버의 인증 거절 문구 대신 로그인 안내로 보냅니다.
      if (!loggedIn) { requireLogin(); navigate('/login'); return false }
      return send(() => useCase.create(workId, n, { body, quote, spoiler }), '댓글을 남겼어요', fail)
    },
    update: (c: EpisodeComment, body: string, spoiler: boolean) => send(() => useCase.update(c, body, spoiler), '댓글을 고쳤어요'),
    remove: async (c: EpisodeComment) => window.confirm('댓글을 삭제할까요? 삭제하면 목록에서 사라져요.') && send(() => useCase.remove(c), '댓글을 삭제했어요'),
    toggleLike: (c: EpisodeComment) => send(() => useCase.toggleLike(c)),
  }
}

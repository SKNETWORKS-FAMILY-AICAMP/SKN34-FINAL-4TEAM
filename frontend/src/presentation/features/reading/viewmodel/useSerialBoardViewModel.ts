import { useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { canHideProposals, proposalInputError, sortProposals, type ProposalInput, type ProposalKind, type ProposalSort, type SerialNotice, type SerialProposal } from '../../../../domain/entities/aiSerial'
import { isPub, type Work } from '../../../../domain/entities/work'
import type { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

const messageOf = (failure: unknown, fallback: string) => (failure instanceof Error && failure.message ? failure.message : fallback)

/**
 * 소설 상세가 '다음 회차' 탭을 보일지 정하려고 게시판을 읽는다([계약](../../../../../../docs/design/ai-serial-contract.md)): 응답의 enabled가 AI 자율 집필 여부다.
 * 서버(정본) 공개 작품만 읽고(데모·비공개 작품·작품이 아직 없을 때는 읽지 않는다), 읽기는 누구나 하며 로그인했으면 내 투표·내 글·내 추천이 함께 온다(로그인 상태가 바뀌면 useAsyncData가 다시 읽는다).
 * 탭 이름과 탭 안 내용이 같은 읽기를 쓰도록 소설 상세가 한 번만 부르고 결과를 useSerialBoardViewModel에 넘긴다.
 */
export function useSerialBoardRead(work: Work | undefined, useCase?: SerialUseCase) {
  const active = !!work && !!work.canonical && isPub(work)
  const api = useCase ?? (active ? appContainer.resolve('serialUseCase') : undefined)
  return useAsyncData((signal) => (active && api ? api.board(work.id, signal) : Promise.resolve(undefined)), [api, work?.id, active])
}

/**
 * 소설 상세 '다음 회차' 탭의 투표·제안 게시판 화면 상태와 요청. 읽기 결과(read)는 소설 상세가 넘겨 주고, 이 훅은 하위 탭·정렬·펼친 글·글쓰기 폼 같은 화면 상태와 쓰기를 맡는다.
 * 쓰기(투표·옮기기·취소·제안 글·추천·숨김)는 한 번에 하나만 보내고, 받아졌든 거절됐든 끝나면 서버가 지금 보는 게시판을 다시 읽는다(이미 바뀐 낡은 화면이 남지 않게).
 * 거절·실패는 알림으로만 알리고 곧바로 다시 시도할 수 있으며, 입력은 그대로 둔다. 작품이 바뀌면 호출 측이 key로 새로 만든다.
 */
export function useSerialBoardViewModel(work: Work, read: ReturnType<typeof useSerialBoardRead>, useCase: SerialUseCase = appContainer.resolve('serialUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const memberId = useAppSelector((s) => s.session.memberId)
  const dispatch = useAppDispatch()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<SerialNotice>()
  const [sub, setSubTab] = useState<'vote' | 'board'>('vote')
  const [sort, setSort] = useState<ProposalSort>('new')
  const [openId, setOpenId] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  // 제안 글 쓰기 폼의 입력(화면 상태). 시뮬레이션의 비트는 한 줄이 하나다.
  const [kind, setKind] = useState<ProposalKind>('general')
  const empty = { title: '', body: '', premise: '', beats: '' }
  const [draft, setDraft] = useState(empty)
  const sending = useRef(false)
  // StrictMode의 가짜 언마운트 뒤에도 새 신호를 쓰도록 effect 안에서 만든다.
  const leaving = useRef<AbortController>(null)
  useEffect(() => {
    const controller = new AbortController()
    leaving.current = controller
    return () => controller.abort()
  }, [])
  const view = read.data

  /** 성공하면 true. 보내는 중이면 무시한다. 입력 거절(UseCase 검증)·서버 거절·네트워크 실패는 알림만 남기고 finally가 잠금을 푼다. */
  const send = async (task: (signal?: AbortSignal) => Promise<unknown>, done: string) => {
    if (sending.current) return false
    sending.current = true
    setBusy(true)
    setNotice(undefined)
    let ok = false
    try {
      await task(leaving.current?.signal)
      ok = true
      if (!leaving.current?.signal.aborted) setNotice({ ok, text: done })
    } catch (failure) {
      if (!leaving.current?.signal.aborted) setNotice({ ok, text: messageOf(failure, '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.') })
    } finally {
      sending.current = false
      setBusy(false)
    }
    read.retry() // 같은 범위에서 이전 게시판을 유지한 채 서버 값으로 다시 읽는다.
    return ok
  }

  /** 성공하면 true. 시뮬레이션은 작성자의 크레딧이 차감되므로 계정 메뉴의 보유 크레딧도 다시 읽게 한다. */
  const submit = async (input: ProposalInput) => {
    const ok = await send((signal) => useCase.submitProposal(work.id, input, signal),
      input.kind === 'simulation' ? '시뮬레이션 제안을 올렸어요. 장면 미리보기를 만드는 데 쓴 크레딧이 차감됐어요.' : '제안 글을 올렸어요.')
    if (ok && input.kind === 'simulation') dispatch(sessionActions.dataChanged())
    return ok
  }

  const draftInput: ProposalInput = kind === 'general'
    ? { kind, title: draft.title, body: draft.body }
    : { kind, title: draft.title, body: draft.body, premise: draft.premise, beats: draft.beats.split('\n') }
  // 필수 입력(제목·내용, 시뮬레이션은 전제까지)을 모두 쓴 뒤에만 규칙을 넘은 이유를 보인다(빈 입력은 보내기가 잠겨 있을 뿐이다).
  const complete = !!draft.title.trim() && !!draft.body.trim() && (kind === 'general' || !!draft.premise.trim())
  const problem = complete ? proposalInputError(draftInput) : null
  const canSubmit = !busy && complete && !problem
  const resetForm = () => { setKind('general'); setDraft(empty); setWriting(false) }

  return {
    /** undefined: 불러오는 중이거나 첫 조회 실패(isError) */
    view,
    isError: read.isError, retry: read.retry, busy, notice,
    loggedIn: role !== null,
    /** 제안 글 숨김 버튼 표시. 권한은 서버가 다시 확인한다. */
    canHide: role !== null && canHideProposals(work, memberId),
    /** 하위 탭('투표'가 처음). 탭을 바꾸면 이전 요청의 알림을 지운다. */
    sub,
    setSub: (next: 'vote' | 'board') => { setSubTab(next); setNotice(undefined) },
    /** 제안 글 정렬('최신순'이 처음)과 정렬된 목록. 서버가 준 view.proposals는 바꾸지 않는다. */
    sort, setSort,
    proposals: view ? sortProposals(view.proposals, sort) : [],
    /** 펼친 제안 글(하나만) */
    openId,
    toggleOpen: (id: string) => setOpenId((current) => (current === id ? null : id)),
    writing, setWriting,
    submit,
    /** 제안 글 쓰기 폼: 입력값과 바꾸는 함수, 규칙을 넘은 이유(problem), 보낼 수 있는지(canSubmit), 보내기(send: 성공하면 입력을 비우고 폼을 닫고 실패하면 그대로 둔다), 취소(cancel). */
    form: {
      kind, setKind, ...draft,
      setTitle: (title: string) => setDraft((current) => ({ ...current, title })),
      setBody: (body: string) => setDraft((current) => ({ ...current, body })),
      setPremise: (premise: string) => setDraft((current) => ({ ...current, premise })),
      setBeats: (beats: string) => setDraft((current) => ({ ...current, beats })),
      problem, canSubmit,
      send: async () => {
        if (!canSubmit) return false
        const ok = await submit(draftInput)
        if (ok) resetForm()
        return ok
      },
      cancel: resetForm,
    },
    vote: (choiceId: string) => send((signal) => useCase.vote(work.id, choiceId, signal), view?.myChoiceId ? '투표를 옮겼어요.' : '투표했어요.'),
    cancelVote: () => send((signal) => useCase.cancelVote(work.id, signal), '투표를 취소했어요.'),
    toggleLike: (p: SerialProposal) => p.likedByMe
      ? send((signal) => useCase.unlikeProposal(work.id, p.id, signal), '추천을 취소했어요.')
      : send((signal) => useCase.likeProposal(work.id, p.id, signal), '추천했어요.'),
    hide: async (proposalId: string) => window.confirm('이 제안 글을 숨길까요? 숨긴 글은 독자에게 보이지 않고 AI 집필에도 쓰이지 않아요.') && send((signal) => useCase.hideProposal(work.id, proposalId, signal), '제안 글을 숨겼어요.'),
    /** 비로그인이 로그인 안내를 누르면 로그인한 뒤 이 작품으로 돌아오게 남긴다(이동은 링크가 맡는다). */
    requireLogin: () => { dispatch(sessionActions.requireLogin({ next: `/work/${work.id}`, msg: '투표·제안·추천은 로그인한 회원만 할 수 있어요.', role: 'user' })) },
  }
}

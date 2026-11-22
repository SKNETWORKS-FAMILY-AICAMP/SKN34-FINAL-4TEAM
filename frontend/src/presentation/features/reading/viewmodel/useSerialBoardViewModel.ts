import { useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { canHideOpinions, opinionInputError, type OpinionInput, type OpinionKind, type SerialNotice } from '../../../../domain/entities/aiSerial'
import type { Work } from '../../../../domain/entities/work'
import type { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

const messageOf = (failure: unknown, fallback: string) => (failure instanceof Error && failure.message ? failure.message : fallback)

/**
 * 소설 상세의 '다음 회차 의견' 게시판([계약](../../../../../../docs/design/ai-serial-contract.md)). 서버 작품만 읽는다(데모 작품은 호출 측이 그리지 않는다).
 * 읽기는 누구나 하고, 로그인했으면 내 의견·내 투표가 함께 온다(로그인 상태가 바뀌면 useAsyncData가 다시 읽는다).
 * 쓰기(의견·투표·옮기기·취소·숨김)는 한 번에 하나만 보내고, 받아졌든 거절됐든 끝나면 서버가 지금 보는 게시판을 다시 읽는다(이미 낸 의견 같은 낡은 화면이 남지 않게).
 * 거절·실패는 알림으로만 알리고 곧바로 다시 시도할 수 있으며, 입력은 그대로 둔다. 의견 쓰기 폼의 입력·규칙 검사·보내기(form)도 여기서 맡아 View는 그대로 그리기만 한다.
 * 작품이 바뀌면 호출 측이 key로 새로 만든다.
 */
export function useSerialBoardViewModel(work: Work, useCase: SerialUseCase = appContainer.resolve('serialUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const memberId = useAppSelector((s) => s.session.memberId)
  const dispatch = useAppDispatch()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<SerialNotice>()
  // 의견 쓰기 폼의 입력(화면 상태). 시뮬레이션의 비트는 한 줄이 하나다.
  const [kind, setKind] = useState<OpinionKind>('general')
  const [draft, setDraft] = useState({ body: '', premise: '', beats: '' })
  const sending = useRef(false)
  // StrictMode의 가짜 언마운트 뒤에도 새 신호를 쓰도록 effect 안에서 만든다.
  const leaving = useRef<AbortController>(null)
  useEffect(() => {
    const controller = new AbortController()
    leaving.current = controller
    return () => controller.abort()
  }, [])
  const { data, isError, retry } = useAsyncData((signal) => useCase.board(work.id, signal), [useCase, work.id])

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
    retry() // 같은 범위에서 이전 게시판을 유지한 채 서버 값으로 다시 읽는다.
    return ok
  }

  /** 성공하면 true. 시뮬레이션은 제출자의 크레딧이 차감되므로 계정 메뉴의 보유 크레딧도 다시 읽게 한다. */
  const submit = async (input: OpinionInput) => {
    const ok = await send((signal) => useCase.submitOpinion(work.id, input, signal),
      input.kind === 'simulation' ? '시뮬레이션 의견을 냈어요. 장면 미리보기를 만드는 데 쓴 크레딧이 차감됐어요.' : '의견을 냈어요.')
    if (ok && input.kind === 'simulation') dispatch(sessionActions.dataChanged())
    return ok
  }

  const draftInput: OpinionInput = kind === 'general' ? { kind, body: draft.body } : { kind, premise: draft.premise, beats: draft.beats.split('\n') }
  const filled = kind === 'general' ? !!draft.body.trim() : !!draft.premise.trim()
  // 쓴 글이 규칙을 넘었을 때만 이유를 보인다(빈 입력은 보내기가 잠겨 있을 뿐이다).
  const problem = filled ? opinionInputError(draftInput) : null
  const canSubmit = !busy && filled && !problem

  return {
    /** undefined: 불러오는 중이거나 첫 조회 실패(isError) */
    view: data,
    isError, retry, busy, notice,
    loggedIn: role !== null,
    /** 의견 숨김 버튼 표시. 권한은 서버가 다시 확인한다. */
    canHide: role !== null && canHideOpinions(work, memberId),
    submit,
    /** 의견 쓰기 폼: 입력값과 바꾸는 함수, 규칙을 넘은 이유(problem), 보낼 수 있는지(canSubmit), 보내기(send: 성공하면 입력을 비우고 실패하면 그대로 둔다). */
    form: {
      kind, setKind, ...draft,
      setBody: (body: string) => setDraft((current) => ({ ...current, body })),
      setPremise: (premise: string) => setDraft((current) => ({ ...current, premise })),
      setBeats: (beats: string) => setDraft((current) => ({ ...current, beats })),
      problem, canSubmit,
      send: async () => {
        if (!canSubmit) return false
        const ok = await submit(draftInput)
        if (ok) setDraft({ body: '', premise: '', beats: '' })
        return ok
      },
    },
    vote: (opinionId: string) => send((signal) => useCase.vote(work.id, opinionId, signal), data?.myVoteOpinionId ? '투표를 옮겼어요.' : '투표했어요.'),
    cancelVote: () => send((signal) => useCase.cancelVote(work.id, signal), '투표를 취소했어요.'),
    hide: async (opinionId: string) => window.confirm('이 의견을 숨길까요? 숨긴 의견은 독자에게 보이지 않고 AI 집필에도 쓰이지 않아요.') && send((signal) => useCase.hideOpinion(work.id, opinionId, signal), '의견을 숨겼어요.'),
    /** 비로그인이 로그인 안내를 누르면 로그인한 뒤 이 작품으로 돌아오게 남긴다(이동은 링크가 맡는다). */
    requireLogin: () => { dispatch(sessionActions.requireLogin({ next: `/work/${work.id}`, msg: '의견과 투표는 로그인한 회원만 할 수 있어요.', role: 'user' })) },
  }
}

/** 의견 쓰기 폼(useSerialBoardViewModel의 form)의 모양 */
export type OpinionFormModel = ReturnType<typeof useSerialBoardViewModel>['form']

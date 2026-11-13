import { useCallback, useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../app/appContainer'
import type { ChatBasis, ChatEvent, ChatFeature, ChatSession, ChatStep, ChatStepInputs, ChatTurn } from '../../../domain/entities/writingChat'

/** 지금 흐르는 SSE 턴. 끝나면 이력을 다시 읽어 세이버에 저장된 내용으로 바꾼다. */
export type LiveTurn = { request: string; steps: ChatStep[]; running: ChatFeature | null; editIndex?: number; resumed?: boolean }

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message !== 'Request cancelled' ? error.message : fallback)

/**
 * 집필실·세계관 화면의 집필 AI 채팅(#331). 대화 원본은 AI 세이버이고, 이 Hook은 Content API로 읽고 보낸 뒤
 * 스트림이 끝나거나 실패하면 이력을 다시 읽어 저장된 상태를 그대로 보인다(실패를 성공처럼 남기지 않는다).
 * workId가 없거나(연결 소설 없음) basis가 없으면(발행 회차 없음) 보내지 않는다.
 */
export function useWritingChatViewModel(workId: string | null, basis: ChatBasis | null, onApplied?: (episode: number) => void) {
  const useCase = appContainer.resolve('writingChatUseCase')
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [live, setLive] = useState<LiveTurn | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)
  const active = useRef<AbortController | null>(null)
  const current = useRef<string | null>(null)
  current.current = threadId

  const refreshSessions = useCallback(async (pick = false) => {
    if (!useCase || !workId) return
    try {
      const rows = await useCase.sessions(workId)
      setSessions(rows)
      if (pick && rows[0] && !current.current) setThreadId(rows[0].threadId)
    } catch (failure) { setError(message(failure, '대화 목록을 불러오지 못했어요.')) }
  }, [useCase, workId])

  const load = useCallback(async (id: string) => {
    if (!useCase || !workId) return
    try {
      const history = await useCase.history(workId, id)
      if (current.current !== id) return
      setTitle(history.title)
      setTurns(history.turns)
    } catch (failure) {
      if (current.current === id) { setTurns([]); setError(message(failure, '대화를 불러오지 못했어요.')) }
    }
  }, [useCase, workId])

  // 작품이 바뀌면 처음부터: 목록을 읽고 가장 최근 대화를 연다.
  useEffect(() => {
    setSessions(null); setThreadId(null); setTurns([]); setLive(null); setError('')
    void refreshSessions(true)
    return () => { active.current?.abort(); active.current = null }
  }, [refreshSessions])

  useEffect(() => { if (threadId && !active.current) void load(threadId) }, [threadId, load])

  const apply = (event: ChatEvent) => setLive((turn) => {
    if (!turn) return turn
    if (event.type === 'plan' || event.type === 'waiting') return { ...turn, steps: event.steps, running: null }
    if (event.type === 'started') return { ...turn, running: event.feature }
    if (event.type === 'step') return { ...turn, running: null, steps: turn.steps.map((s) => (s.feature === event.step.feature ? event.step : s)) }
    return turn
  })

  /** 스트림 하나를 끝까지 읽고 이력·목록을 다시 읽는다. 실패도 저장 여부는 이력이 알려 준다. */
  async function stream(request: string, input: { request: string } | { resume: { approved: boolean; inputs?: ChatStepInputs } }, editIndex?: number) {
    if (active.current) return false
    if (!useCase || !workId || !basis || !consent) { setError(lockedReason ?? '지금은 보낼 수 없어요.'); return false }
    const controller = new AbortController()
    active.current = controller
    setPending(true); setError('')
    const resumed = 'resume' in input
    // 이어가기는 멈춘 턴의 계획을 그대로 이어 보여 준다(같은 턴이 두 번 보이지 않게 화면이 그 턴을 감춘다).
    setLive({ request, steps: resumed ? turns.at(-1)?.reply?.steps ?? [] : [], running: null, editIndex, resumed })
    let ok = true
    let id = threadId
    try {
      id ??= await useCase.open(workId, controller.signal)
      if (!threadId) { current.current = id; setThreadId(id) }
      await useCase.send(workId, id, { ...basis, consent: true, ...input }, (event) => {
        if (active.current !== controller) return
        if (event.type === 'error') { ok = false; setError(event.message) }
        if (event.type === 'step' && event.step.applied) onApplied?.(event.step.applied.episode)
        apply(event)
      }, controller.signal, editIndex)
    } catch (failure) {
      ok = false
      if (!controller.signal.aborted) setError(message(failure, '보내지 못했어요. 잠시 후 다시 시도해 주세요.'))
    } finally {
      if (active.current === controller) {
        active.current = null
        if (id) await load(id)
        setLive(null); setPending(false)
        void refreshSessions()
      }
    }
    return ok
  }

  async function change(run: () => Promise<void>, fallback: string) {
    if (!useCase || !workId || !threadId || active.current) return false
    setPending(true); setError('')
    try { await run(); return true } catch (failure) { setError(message(failure, fallback)); return false } finally { setPending(false) }
  }

  const lockedReason = !useCase ? '데모에서는 집필 AI 채팅을 지원하지 않아요.'
    : !workId ? '세계관에 소설을 연결하면 그 소설을 근거로 AI와 대화할 수 있어요.'
      : !basis ? '회차를 하나 이상 발행하면 AI와 대화할 수 있어요. AI는 발행한 회차를 근거로 답해요.'
        : !consent ? '입력창 위 동의에 체크하면 보낼 수 있어요.' : undefined
  const waiting = !live && turns.at(-1)?.reply?.status === 'waiting' ? turns.at(-1)!.reply! : null

  return {
    sessions, threadId, title, turns, live, waiting, pending, error, consent, setConsent, lockedReason,
    available: !!useCase && !!workId && !!basis, basisEpisode: basis?.episode ?? null,
    dismissError: () => setError(''),
    select: (id: string) => { if (active.current || id === threadId) return; current.current = id; setTurns([]); setError(''); setThreadId(id) },
    startNew: () => { if (active.current) return; current.current = null; setThreadId(null); setTurns([]); setTitle(''); setError('') },
    send: (text: string) => stream(text, { request: text }),
    edit: (index: number, text: string) => stream(text, { request: text }, index),
    resume: (approved: boolean, inputs?: ChatStepInputs) => stream(turns.at(-1)?.request ?? '', { resume: { approved, inputs } }),
    deleteFrom: (index: number) => change(async () => {
      await useCase!.truncate(workId!, threadId!, index)
      if (index === 0) { current.current = null; setThreadId(null); setTurns([]); setTitle('') } else await load(threadId!)
      await refreshSessions()
    }, '메시지를 지우지 못했어요.'),
    rename: (next: string) => change(async () => { await useCase!.rename(workId!, threadId!, next); setTitle(next.trim()); await refreshSessions() }, '제목을 바꾸지 못했어요.'),
    remove: () => change(async () => {
      await useCase!.remove(workId!, threadId!)
      current.current = null; setThreadId(null); setTurns([]); setTitle('')
      await refreshSessions()
    }, '대화를 지우지 못했어요.'),
    retry: () => { setError(''); void refreshSessions(); if (threadId) void load(threadId) },
  }
}

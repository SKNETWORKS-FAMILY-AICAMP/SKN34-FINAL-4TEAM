import { useCallback, useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../app/appContainer'
import type { SimulationStart } from '../../../domain/entities/characterSimulation'
import { attachmentKind, type ChatAttachmentPayload, type ChatTurnAttachment } from '../../../domain/entities/chatAttachment'
import { streamedAnswer, type ChatBasis, type ChatEvent, type ChatFeature, type ChatPage, type ChatSendBody, type ChatSession, type ChatStep, type ChatStepInputs, type ChatTurn, type SceneAction } from '../../../domain/entities/writingChat'
import { readAttachments } from './readAttachments'

/** 지금 흐르는 SSE 턴. 끝나면 이력을 다시 읽어 세이버에 저장된 내용으로 바꾼다. decision은 승인·거절 응답(장면 조작이 아닌 이어가기)이다. */
/** answer: 쓰는 중인 답변 본문(#618). running: 시작(started)했지만 결과(step)가 아직 없는 기능들. 병렬 호출(#474)이면 둘 이상이다. */
export type LiveTurn = { request: string; answer: string; steps: ChatStep[]; running: ChatFeature[]; editIndex?: number; resumed?: boolean; decision?: boolean; attachments?: ChatTurnAttachment[] }

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message !== 'Request cancelled' ? error.message : fallback)

/**
 * 집필실·세계관 화면의 집필 AI 채팅(#331). 대화 원본은 AI 세이버이고, 이 Hook은 Content API로 읽고 보낸 뒤
 * 스트림이 끝나거나 실패하면 이력을 다시 읽어 저장된 상태를 그대로 보인다(실패를 성공처럼 남기지 않는다).
 * workId가 없거나(연결 소설 없음) basis가 없으면(발행 회차 없음) 보내지 않는다.
 * getPage(#554)는 새 메시지(보내기·고쳐 다시 보내기)를 보내는 순간의 화면 정보를 읽는다. 편집기의 선택 글은 상태가 아니라 보내는 때 읽어야 해서 값이 아니라 함수다.
 * 이어가기(승인·입력·장면 조작)에는 싣지 않는다.
 * 승인한 계획 저장(계획 수정 revise_plan, Content 도구 story_plan_create·story_plan_update)은 회차 초안이 아니라 계획을 바꾸므로 onPlanApplied(#637)로만 알린다.
 */
export function useWritingChatViewModel(workId: string | null, basis: ChatBasis | null, onApplied?: (episode: number) => void, onWorldApplied?: () => void, getPage?: () => ChatPage | undefined, onPlanApplied?: () => void) {
  const useCase = appContainer.resolve('writingChatUseCase')
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [live, setLive] = useState<LiveTurn | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [inputError, setInputError] = useState('')
  // 턴 사이에 멈춘 시뮬레이션 장면이 작가 조작을 기다리게 된 횟수(무대가 자동 재생이면 이 값이 오를 때마다 다음 턴을 보낸다).
  const [sceneTicket, setSceneTicket] = useState(0)
  const active = useRef<AbortController | null>(null)
  const current = useRef<string | null>(null)
  const sessionsRequest = useRef<AbortController | null>(null)
  // 작품(또는 UseCase)이 바뀔 때마다 오른다. 이전 작품의 요청이 뒤늦게 이 작품의 목록·장면 신호를 건드리지 못하게 한다.
  const generation = useRef(0)
  current.current = threadId
  // 스트림은 몇 분 걸릴 수 있어 World 반영 알림은 시작할 때가 아니라 도착한 지금의 핸들러로 보낸다(그사이 저장하지 않은 변경이 생길 수 있다).
  const worldApplied = useRef(onWorldApplied)
  worldApplied.current = onWorldApplied
  const page = useRef(getPage)
  page.current = getPage

  const refreshSessions = useCallback(async (pick = false) => {
    if (!useCase || !workId) return
    sessionsRequest.current?.abort()
    const controller = new AbortController()
    sessionsRequest.current = controller
    try {
      const rows = await useCase.sessions(workId, controller.signal)
      if (controller.signal.aborted) return
      setSessions(rows)
      if (pick && rows[0] && !current.current) setThreadId(rows[0].threadId)
    } catch (failure) {
      if (!controller.signal.aborted) setError(message(failure, '대화 목록을 불러오지 못했어요.'))
    }
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
    setSessions(null); setThreadId(null); setTurns([]); setLive(null); setPending(false); setError(''); setInputError('')
    void refreshSessions(true)
    return () => { generation.current += 1; sessionsRequest.current?.abort(); active.current?.abort(); active.current = null }
  }, [refreshSessions])

  useEffect(() => { if (threadId && !active.current) void load(threadId) }, [threadId, load])

  const apply = (event: ChatEvent) => setLive((previous) => {
    if (!previous) return previous
    const turn = { ...previous, answer: streamedAnswer(previous.answer, event) }
    if (event.type === 'plan' || event.type === 'waiting') return { ...turn, steps: event.steps, running: [] }
    if (event.type === 'started') return { ...turn, running: [...turn.running, event.feature] }
    // content_action(#554)은 판정이 계획에 올리지 않고 한 턴에 여러 번일 수 있어 단계마다 덧붙인다.
    if (event.type === 'step') {
      const own = event.step.feature !== 'content_action' && turn.steps.some((s) => s.feature === event.step.feature)
      return { ...turn, running: turn.running.filter((f) => f !== event.step.feature), steps: own ? turn.steps.map((s) => (s.feature === event.step.feature ? event.step : s)) : [...turn.steps, event.step] }
    }
    return turn
  })

  /** 스트림 하나를 끝까지 읽고 이력·목록을 다시 읽는다. 실패도 저장 여부는 이력이 알려 준다. */
  async function stream(request: string, input: ChatSendBody, editIndex?: number) {
    if (active.current) return false
    if (!useCase || !workId || !basis) { setError(lockedReason ?? '지금은 보낼 수 없어요.'); return false }
    let screen: ChatPage | undefined
    try {
      screen = 'request' in input ? page.current?.() : undefined
    } catch (failure) {
      setInputError(message(failure, '보낼 화면 정보를 읽지 못했어요.'))
      return false
    }
    setInputError('')
    const controller = new AbortController()
    active.current = controller
    const owner = generation.current
    setPending(true); setError('')
    const resumed = 'resume' in input
    // 이어가기는 멈춘 턴의 계획을 그대로 이어 보여 준다(같은 턴이 두 번 보이지 않게 화면이 그 턴을 감춘다).
    const decision = 'resume' in input && !input.resume.scene
    // 첨부 칩: 새 요청은 이번에 보낸 파일 이름, 이어가기는 멈춘 턴의 칩을 그대로 둔다(그 턴의 내 메시지가 이 줄로 바뀐다).
    const attachments = resumed ? turns.at(-1)?.attachments : 'attachments' in input ? input.attachments?.map(({ name, mediaType }) => ({ name, kind: attachmentKind(mediaType) })) : undefined
    setLive({ request, answer: '', steps: resumed ? turns.at(-1)?.reply?.steps ?? [] : [], running: [], editIndex, resumed, decision, attachments })
    let ok = true
    let sceneWaits = false
    let id = threadId
    try {
      id ??= await useCase.open(workId, controller.signal)
      if (!threadId) { current.current = id; setThreadId(id) }
      await useCase.send(workId, id, { ...basis, ...input, ...(screen ? { page: screen } : {}) }, (event) => {
        if (active.current !== controller) return
        if (event.type === 'error') { ok = false; setError(event.message) }
        if (event.type === 'waiting' && event.awaitingScene === 'character_simulation') sceneWaits = true
        // World 반영은 회차 초안이 아니라 설정집 초안을 바꾼다(applied.episode는 회차가 아니다). 승인한 Content 세계관 카드 수정(#554)도 같다.
        // 계획 수정(#578)과 Content 계획 도구는 저장된 계획만 바꿔 회차 초안·설정집 초안 어느 쪽도 다시 읽을 필요가 없고, 계획 패널·시작 양식이 계획을 다시 읽는다(#637).
        if (event.type === 'step' && event.step.applied) {
          const tool = event.step.result?.tool
          if (event.step.feature === 'world' || tool === 'world_studio_edit_draft') worldApplied.current?.()
          else if (event.step.task === 'revise_plan' || tool === 'story_plan_create' || tool === 'story_plan_update') onPlanApplied?.()
          else onApplied?.(event.step.applied.episode)
        }
        apply(event)
      }, controller.signal, editIndex)
    } catch (failure) {
      ok = false
      if (!controller.signal.aborted) setError(message(failure, '보내지 못했어요. 잠시 후 다시 시도해 주세요.'))
    } finally {
      if (active.current === controller) {
        active.current = null
        if (id) await load(id)
        // 이력을 읽는 사이 작품이 바뀌었으면 뒷정리는 새 작품의 상태를 건드리지 않는다(옛 요청이 sceneTicket을 올려 새 작품의 멈춘 장면이 저절로 재생되던 문제).
        if (generation.current === owner) {
          setLive(null); setPending(false)
          void refreshSessions()
          // 실패한 턴은 알리지 않는다: 무대가 저절로 다음 턴을 보내지 않고 작가가 다시 시도한다.
          if (ok && sceneWaits) setSceneTicket((n) => n + 1)
        }
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
      : !basis ? '회차를 하나 이상 발행하면 AI와 대화할 수 있어요. AI는 발행한 회차를 근거로 답해요.' : undefined
  const waiting = !live && turns.at(-1)?.reply?.status === 'waiting' ? turns.at(-1)!.reply! : null
  // 인물 시뮬레이션 장면(#58 무대): 흐르는 중이면 SSE로 받은 단계, 아니면 저장된 마지막 응답의 단계. 장면을 못 읽은 단계는 simulation 없이 실패로 온다.
  const simulationStep = (live ? live.steps : turns.at(-1)?.reply?.steps)?.find((step) => step.feature === 'character_simulation') ?? null
  const awaiting = waiting?.awaitingScene === 'character_simulation' ? 'scene' as const : waiting?.awaitingApproval === 'character_simulation' ? 'approval' as const : null

  return {
    sessions, threadId, title, turns, live, waiting, pending, error, inputError, lockedReason,
    available: !!useCase && !!workId && !!basis, basisEpisode: basis?.episode ?? null,
    // 결과를 반영할 회차(작가가 연 회차). 근거 회차와 다를 수 있다(5화 초안은 4화까지를 근거로 5화에 반영한다).
    targetEpisode: basis?.targetEpisode ?? basis?.episode ?? null,
    simulation: simulationStep?.simulation ?? null, simulationStep, awaiting, approvalEpisode: waiting?.approvalEpisode ?? null,
    streaming: !!live, deciding: !!live?.decision, sceneTicket,
    dismissError: () => setError(''),
    select: (id: string) => { if (active.current || id === threadId) return; current.current = id; setTurns([]); setError(''); setInputError(''); setThreadId(id) },
    startNew: () => { if (active.current) return; current.current = null; setThreadId(null); setTurns([]); setTitle(''); setError(''); setInputError('') },
    /** files는 새 요청의 첨부다. 보내기 전에 읽고(텍스트 한도 확인) 읽지 못하면 이유를 입력 아래에 알리고 보내지 않는다(글·첨부는 입력창이 되돌린다). */
    send: async (text: string, extra?: { operation?: ChatFeature; simulation?: SimulationStart; files?: File[] }) => {
      const { files, ...rest } = extra ?? {}
      let attachments: ChatAttachmentPayload[] | undefined
      try {
        // 잠겼거나 다른 스트림이 도는 중이면 읽지 않는다(stream이 이유와 함께 거절한다).
        attachments = files?.length && !active.current && !lockedReason ? await readAttachments(files) : undefined
      } catch (failure) {
        setInputError(message(failure, '첨부 파일을 읽지 못했어요.'))
        return false
      }
      return stream(text, { request: text, ...rest, ...(attachments ? { attachments } : {}) })
    },
    edit: (index: number, text: string) => stream(text, { request: text }, index),
    resume: (approved: boolean, inputs?: ChatStepInputs) => stream(turns.at(-1)?.request ?? '', { resume: { approved, inputs } }),
    /** 무대의 장면 조작(다음 턴·줄 수정·다시 말하기·끝내기). 멈춘 장면을 이어 가는 요청이라 approved는 서버 검증용으로 함께 보낸다. */
    sceneAction: (action: SceneAction) => stream(turns.at(-1)?.request ?? '', { resume: { approved: true, scene: action } }),
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

/** 집필 AI 채팅 ViewModel. 집필실은 무대(시뮬레이션)와 이 상태를 함께 쓰려고 직접 만들어 채팅·무대에 내려 준다. */
export type ChatViewModel = ReturnType<typeof useWritingChatViewModel>

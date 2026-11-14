import { useEffect, useEffectEvent, useState } from 'react'

import {
  characterNames, cleanSimulation, sceneProse, sceneRows, simulationIssue, simulationSummary, statusLabel, stopReasonText, type SimulationStart,
} from '../../../domain/entities/characterSimulation'
import { bodyLength } from '../../../domain/entities/manuscriptLength'
import type { ChatViewModel } from './useWritingChatViewModel'

const CONSENT_FIRST = '동의에 체크하면 보낼 수 있어요.'
const LINES_LOCKED = '줄 수정과 다시 말하기는 일시정지한 뒤 턴이 끝나면 쓸 수 있어요.'

/**
 * 인물 시뮬레이션 무대(#58)의 상태·동작. 요청·SSE·이력은 채팅 ViewModel이 맡고, 이 Hook은 그 위에서 정한다:
 * 자동 재생(턴 사이 대기마다 다음 턴 요청)·일시정지·장면 끝내기·끼어들기·줄 수정·다시 말하기·원고 반영.
 * 자동 재생은 이 화면에서 시작·재생한 장면만 이어 간다(새로 고친 뒤 이어진 장면은 멈춘 채로 보이고 재생을 눌러야 한다).
 */
export function useSimulationStageViewModel(chat: ChatViewModel) {
  const sim = chat.simulation
  const step = chat.simulationStep
  const [open, setOpen] = useState(false)
  // 끝난 장면 대신 새 시작 양식을 본다.
  const [composing, setComposing] = useState(false)
  // 이 무대에서 시작한 요청의 답(되묻기·거절)을 양식 위에 보인다.
  const [asked, setAsked] = useState(false)
  // 작가가 멈췄다. 서버에 가 있는 턴은 마치고 다음 턴만 보내지 않는다.
  const [paused, setPaused] = useState(false)
  const [stopAfterTurn, setStopAfterTurn] = useState(false)
  // 다음 턴(또는 다시 말하기)에 실을 끼어들기. 요청에 실린 뒤 지우고, 못 보냈으면 되살린다.
  const [queued, setQueued] = useState('')
  // 자동 재생이 처리한 chat.sceneTicket.
  const [consumed, setConsumed] = useState(0)
  // 시작 양식에서 고른 인물의 이름(id → 이름). 아직 말하지 않은 인물의 시점 이름을 채운다. 새로 고치면 없고, 그때는 줄이 알려 주는 이름만 쓴다.
  const [roster, setRoster] = useState<Record<string, string>>({})

  const live = !!sim && !chat.deciding && (chat.streaming || chat.awaiting === 'scene')
  // 진행 중이거나 작가의 답(다음 턴·승인)을 기다리는 장면이 있다.
  const attention = !!sim && (chat.streaming || !!chat.awaiting)
  const playing = live && !paused && (chat.streaming || chat.sceneTicket !== consumed)
  const blocked = chat.available ? (chat.consent ? '' : CONSENT_FIRST) : chat.lockedReason ?? ''
  const canAct = !chat.pending && !!chat.awaiting && !blocked

  useEffect(() => { if (attention) { setOpen(true); setComposing(false); setAsked(false) } }, [attention])
  useEffect(() => { if (!live) { setPaused(false); setStopAfterTurn(false) } }, [live])

  const withNote = async (run: (note: string) => Promise<boolean>) => {
    const note = queued
    setQueued('')
    const ok = await run(note)
    if (!ok) setQueued((current) => current || note)
    return ok
  }
  const sendNext = () => withNote((note) => chat.sceneAction({ action: 'next', note }))

  // 턴 사이 대기마다(sceneTicket) 자동 재생이면 다음 턴을, 끝내기를 눌렀으면 stop을 보낸다. 실패한 턴은 표시가 오르지 않아 멈춘다.
  const advance = useEffectEvent((ticket: number) => {
    setConsumed(ticket)
    if (chat.awaiting !== 'scene') return
    if (stopAfterTurn) { setStopAfterTurn(false); void chat.sceneAction({ action: 'stop' }) } else if (!paused) void sendNext()
  })
  useEffect(() => { if (chat.sceneTicket !== consumed) advance(chat.sceneTicket) }, [chat.sceneTicket, consumed])

  const running = playing || chat.streaming
  // 작가가 멈춘 게 아닌데 오류가 있으면 오류로 멈춘 것이다(다시 시도는 재생).
  const errored = !!chat.error && !paused
  const shown = !sim ? '' : sim.status === 'running' || sim.status === 'paused' ? (running ? 'running' : errored ? 'error' : 'paused') : sim.status
  const result = step?.applied ? `${step.applied.episode}화 초안 끝에 이어 붙였어요.` : step?.approval === 'declined' ? '반영하지 않았어요. 장면은 대화에 남아 있어요.' : ''
  const stoppedOrFailed = sim?.status === 'stopped' || sim?.status === 'failed'

  return {
    open, hide: () => setOpen(false), compose: () => setComposing(true),
    /** [시뮬레이션] 버튼: 진행 중이거나 답을 기다리는 장면이 있으면 그 장면을, 아니면 새 시작 양식을 연다. */
    show: () => { setOpen(true); setAsked(false); if (!attention) setComposing(true) },
    simulation: sim, rows: sim ? sceneRows(sim, roster) : [], names: sim ? characterNames(sim, roster) : {}, showForm: !sim || composing,
    live, playing, canAct, blocked, queued, finishing: stopAfterTurn,
    statusKey: shown, statusText: shown === 'paused' ? '일시정지' : shown === 'error' ? '오류로 멈춤' : shown && statusLabel[shown],
    hint: chat.deciding ? '답을 보내고 있어요…'
      : !live ? (stoppedOrFailed && !chat.pending && !chat.awaiting && !result ? '흐름 수정이나 다시 시도는 채팅으로 요청해 주세요.' : '')
        : chat.streaming ? (stopAfterTurn ? '이번 턴을 마치면 장면을 끝내요.' : paused ? '이번 턴을 마치면 멈춰요.' : '다음 줄을 만들고 있어요…')
          : playing ? '' : errored ? '오류로 멈췄어요 · 재생하면 다시 시도해요' : stoppedOrFailed ? '멈춘 장면이에요. 줄을 고치거나 다시 말하게 한 뒤 재생해 이어 가세요.' : '일시정지됨 · 재생하면 다음 줄을 만들어요.',
    // 줄 행동(수정·다시 말하기)과 끼어들기는 진행 중이거나 승인을 기다리는 장면에만 둔다. linesLock은 그 줄 행동이 잠긴 이유다.
    interactive: live || chat.awaiting === 'approval',
    linesLock: !sim ? '' : chat.pending ? LINES_LOCKED : chat.awaiting ? blocked : '',
    // 승인 대기 장면이 실패가 아니고 턴이 있으면 원고 반영을 묻는다. 시스템이 멈춘 장면은 승인이 아니라 장면 조작(다시 말하기 등)으로 이어 간다.
    approvable: chat.awaiting === 'approval' && !!sim && sim.status !== 'failed' && sim.turns.length > 0,
    target: chat.approvalEpisode ? `${chat.approvalEpisode}화 초안` : '초안',
    approveChars: sim ? bodyLength(sceneProse(sim)) : 0,
    result,
    // 멈춘·실패한 장면의 이유: 서버는 사람이 읽을 문장을 단계 error에 주고 stopReason은 코드값이다. 문장이 없을 때만 코드를 문구로 바꾼다.
    stopText: stoppedOrFailed ? step?.error || (sim?.stopReason ? stopReasonText(sim.stopReason) : '') : '',
    sceneError: step && !step.simulation && step.status === 'failed' ? step.error ?? '시뮬레이션을 완료하지 못했어요.' : '',
    answer: asked && !sim && !chat.pending ? chat.turns.at(-1)?.reply?.message ?? '' : '',
    // 이 무대에서 시작한 요청이 첫 턴을 만드는 중이다(아직 장면이 없다).
    starting: asked && !sim && chat.streaming,
    available: chat.available, consent: chat.consent, setConsent: chat.setConsent, pending: chat.pending, deciding: chat.deciding,
    error: chat.error, reload: chat.retry,
    issue: simulationIssue,
    start: (start: SimulationStart, source: 'plan' | 'manual' = 'manual', names: Record<string, string> = {}) => {
      if (simulationIssue(start) || blocked || chat.pending) return Promise.resolve(false)
      // 양식은 첫 장면이 올 때(attention) 닫힌다: 요청이 실패하면 옛 장면이 아니라 입력한 양식이 남는다.
      setPaused(false); setStopAfterTurn(false); setAsked(true); setRoster(names); setQueued('')
      return chat.send(simulationSummary(cleanSimulation(start), source), { operation: 'character_simulation', simulation: start })
    },
    play: () => {
      chat.dismissError()
      setPaused(false); setStopAfterTurn(false)
      if (!chat.pending && chat.awaiting === 'scene') void sendNext()
    },
    pause: () => setPaused(true),
    finish: () => {
      setPaused(true)
      if (chat.streaming) setStopAfterTurn(true)
      else if (chat.awaiting === 'scene') void chat.sceneAction({ action: 'stop' })
    },
    // 고치거나 다시 말하게 하면 멈춘다: 결과를 보고 재생을 눌러 이어 간다.
    edit: (turn: number, text: string) => { setPaused(true); return chat.sceneAction({ action: 'edit', turn, text }) },
    redo: async (turn: number) => {
      const later = (sim?.turns ?? []).filter((item) => item.index > turn).length
      if (later && !window.confirm(`이 줄 뒤의 ${later}줄이 지워지고 이 줄부터 다시 만들어요. 계속할까요?`)) return false
      setPaused(true)
      return withNote((note) => chat.sceneAction({ action: 'redo', turn, note }))
    },
    leaveNote: (text: string) => { const note = text.trim(); if (note) setQueued(note); return !!note },
    clearNote: () => setQueued(''),
    approve: () => chat.resume(true),
    decline: () => chat.resume(false),
    /** 승인 대기에서 끼어들기를 남기고 장면을 더 이어 간다. */
    continueScene: () => { setPaused(false); setStopAfterTurn(false); return sendNext() },
  }
}

/** 무대 ViewModel. SimulationStage가 이 값만 그린다. */
export type StageViewModel = ReturnType<typeof useSimulationStageViewModel>

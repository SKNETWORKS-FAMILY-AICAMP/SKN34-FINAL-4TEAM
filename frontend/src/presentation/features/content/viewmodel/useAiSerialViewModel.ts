import { useCallback, useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { serialRunBlock, serialRunning, serialSettingsError, type SerialBoardRecord, type SerialDay, type SerialNotice, type SerialScheduleInput, type SerialSettings } from '../../../../domain/entities/aiSerial'
import type { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'

/** 대기·실행 중인 게시판이 있는 동안 기록을 다시 읽는 간격(ms). ponytail: 고정 5초 주기 읽기(열린 화면마다 한 요청). 화면이 많아지면 알림 SSE 신호로 바꾼다. */
const POLL_MS = 5000

const messageOf = (failure: unknown, fallback: string) => (failure instanceof Error && failure.message ? failure.message : fallback)
const same = (a: SerialSettings, b: SerialSettings) =>
  a.enabled === b.enabled && a.time === b.time && a.direction.trim() === b.direction.trim() && a.days.length === b.days.length && a.days.every((day) => b.days.includes(day))

/**
 * 작품 관리 'AI 집필' 탭([계약](../../../../../../docs/design/ai-serial-contract.md)): 설정 읽기·저장, 지금 마감·실행, 게시판 기록.
 * 저장·실행은 한 번에 하나만 보내고, 거절·실패는 입력을 그대로 두고 알리며 곧바로 다시 시도할 수 있다. 저장(PUT)이 성공하면 곧바로 저장 완료로 알리고,
 * 서버 값 다시 읽기(설정·기록)는 따로 해서 각 실패를 따로 알린다(읽기 실패가 저장 실패로 보이지 않게). 실행은 받아졌든 거절됐든 기록을 다시 읽는다.
 * 기록은 대기·실행 중인 게시판이 있는 동안만 주기적으로 다시 읽는다. 화면을 떠나면 읽기·쓰기 요청을 함께 취소한다. 작품이 바뀌면 호출 측이 key로 새로 만든다.
 * 켜짐은 운영 설정의 집필 방식(AI 자율 집필)이 정하므로 이 화면은 요일·시각·방향만 저장하고 enabled는 서버 값을 읽기만 한다.
 * 화면은 하위 탭 '연재 설정 | 게시판 기록'이고(sub, 연재 설정이 처음) 탭을 바꾸면 이전 요청의 알림을 지운다.
 */
export function useAiSerialViewModel(workId: string, useCase: SerialUseCase = appContainer.resolve('serialUseCase')) {
  const [saved, setSaved] = useState<SerialSettings>()
  const [form, setForm] = useState<SerialSettings>()
  const [boards, setBoards] = useState<SerialBoardRecord[]>()
  const [loadError, setLoadError] = useState('')
  const [boardsError, setBoardsError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<SerialNotice>()
  const [sub, setSubTab] = useState<'settings' | 'history'>('settings')
  const busy = useRef(false)
  // StrictMode의 가짜 언마운트 뒤에도 새 신호를 쓰도록 effect 안에서 만든다.
  const leaving = useRef<AbortController>(null)
  const boardsRead = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    leaving.current = controller
    return () => controller.abort()
  }, [])

  /** 기록은 가장 나중에 시작한 읽기만 반영한다(주기 읽기와 저장·실행 뒤 읽기가 겹쳐도 옛 응답이 덮지 않게). */
  const refreshBoards = useCallback(async () => {
    boardsRead.current?.abort()
    const read = new AbortController()
    boardsRead.current = read
    try {
      const rows = await useCase.boards(workId, read.signal)
      if (read.signal.aborted) return
      setBoards(rows)
      setBoardsError('')
    } catch (failure) {
      if (!read.signal.aborted) setBoardsError(messageOf(failure, '게시판 기록을 불러오지 못했어요.'))
    }
  }, [useCase, workId])

  useEffect(() => {
    const read = new AbortController()
    useCase.settings(workId, read.signal).then(
      (result) => { if (!read.signal.aborted) { setSaved(result); setForm(result) } },
      (failure: unknown) => { if (!read.signal.aborted) setLoadError(messageOf(failure, 'AI 집필 설정을 불러오지 못했어요.')) },
    )
    void refreshBoards()
    return () => {
      read.abort()
      boardsRead.current?.abort()
    }
  }, [useCase, workId, refreshBoards, attempt])

  const active = serialRunning(boards)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => void refreshBoards(), POLL_MS)
    return () => clearInterval(timer)
  }, [active, refreshBoards])

  const formError = form ? serialSettingsError(form) : null
  const dirty = !!form && !!saved && !same(form, saved)
  const canSave = dirty && !formError && !saving
  const runBlock = serialRunBlock(saved, boards, !!loadError || !!boardsError)

  const change = (update: (current: SerialSettings) => SerialSettings) => {
    setForm((current) => current && update(current))
    setNotice(undefined)
  }

  /** 서버가 저장한 설정을 다시 읽어 기준 설정만 맞춘다(입력 칸은 건드리지 않는다: 그새 고친 입력을 지우지 않게). 실패는 설정 읽기 실패로 따로 알린다. */
  async function rereadSettings(signal?: AbortSignal) {
    try {
      const result = await useCase.settings(workId, signal)
      if (signal?.aborted) return
      setSaved(result)
      setLoadError('')
    } catch (failure) {
      if (!signal?.aborted) setLoadError('저장은 됐지만 최신 설정을 다시 불러오지 못했어요. ' + messageOf(failure, '연결 상태를 확인해 주세요.'))
    }
  }

  async function save() {
    if (!form || !canSave || busy.current) return
    busy.current = true
    setSaving(true)
    setNotice(undefined)
    const signal = leaving.current?.signal
    let ok = false
    try {
      // 저장(PUT)이 끝났으면 보낸 값(요일·시각·방향)을 기준으로 삼고 저장 완료를 알린다. 서버 값 다시 읽기는 아래에서 따로 한다.
      const sent = await useCase.saveSettings(workId, form, signal)
      if (signal?.aborted) return
      setSaved({ ...form, ...sent })
      setForm({ ...form, ...sent })
      setNotice({ ok: true, text: '설정을 저장했어요.' })
      ok = true
    } catch (failure) {
      if (!signal?.aborted) setNotice({ ok: false, text: messageOf(failure, '설정을 저장하지 못했어요.') })
    } finally {
      busy.current = false
      setSaving(false)
    }
    // 설정과 기록은 각각 읽고 한쪽이 실패해도 저장 완료 알림과 다른 쪽 읽기는 그대로다. 저장하면 게시판이 열릴 수 있어 기록도 서버 값으로 다시 읽는다.
    if (ok) await Promise.all([rereadSettings(signal), refreshBoards()])
  }

  async function run() {
    if (runBlock || busy.current) return
    busy.current = true
    setRunning(true)
    setNotice(undefined)
    const signal = leaving.current?.signal
    try {
      await useCase.run(workId, signal)
      if (!signal?.aborted) setNotice({ ok: true, text: '실행을 요청했어요. 곧 집필이 시작돼요.' })
    } catch (failure) {
      if (!signal?.aborted) setNotice({ ok: false, text: messageOf(failure, '실행을 요청하지 못했어요.') })
    } finally {
      busy.current = false
      setRunning(false)
    }
    // 요청이 받아졌든 거절됐든 서버가 지금 보는 상태를 다시 보인다. 화면을 떠나 취소됐으면 보일 곳이 없어 읽지 않는다.
    if (!signal?.aborted) await refreshBoards()
  }

  function reload() {
    setSaved(undefined)
    setForm(undefined)
    setLoadError('')
    setAttempt((count) => count + 1)
  }

  return {
    /** 서버에 저장된 설정. undefined: 불러오는 중이거나 읽기 실패(loadError) */
    saved,
    /** 화면 입력(서버 값으로 시작). 저장하기 전에는 서버에 닿지 않는다. */
    form,
    /** 게시판 기록(최신순). undefined: 불러오는 중이거나 읽기 실패(boardsError) */
    boards,
    loadError, boardsError, notice, saving, running, dirty, formError, canSave,
    sub,
    setSub: (next: 'settings' | 'history') => { setSubTab(next); setNotice(undefined) },
    /** 지금 마감·실행을 못 하는 이유. null이면 할 수 있다. */
    runBlock,
    edit: (patch: Partial<SerialScheduleInput>) => change((current) => ({ ...current, ...patch })),
    toggleDay: (day: SerialDay) => change((current) => ({ ...current, days: current.days.includes(day) ? current.days.filter((d) => d !== day) : [...current.days, day] })),
    save, run, refreshBoards, reload,
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { serialRunBlock, serialSettingsError, type SerialBoardRecord, type SerialDay, type SerialNotice, type SerialSettings } from '../../../../domain/entities/aiSerial'
import type { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'

/** 대기·실행 중인 게시판이 있는 동안 기록을 다시 읽는 간격(ms). ponytail: 고정 5초 주기 읽기(열린 화면마다 한 요청). 화면이 많아지면 알림 SSE 신호로 바꾼다. */
const POLL_MS = 5000

const messageOf = (failure: unknown, fallback: string) => (failure instanceof Error && failure.message ? failure.message : fallback)
const same = (a: SerialSettings, b: SerialSettings) =>
  a.enabled === b.enabled && a.time === b.time && a.direction.trim() === b.direction.trim() && a.days.length === b.days.length && a.days.every((day) => b.days.includes(day))

/**
 * 작품 관리 'AI 집필' 탭([계약](../../../../../../docs/design/ai-serial-contract.md)): 설정 읽기·저장, 지금 마감·실행, 게시판 기록.
 * 저장·실행은 한 번에 하나만 보내고, 성공하면 서버 값을 다시 읽어 보인다(저장은 서버가 저장한 값, 실행은 기록). 거절·실패는 입력을 그대로 두고 알리며 곧바로 다시 시도할 수 있다.
 * 기록은 대기·실행 중인 게시판이 있는 동안만 주기적으로 다시 읽는다. 화면을 떠나면 읽기·쓰기 요청을 함께 취소한다. 작품이 바뀌면 호출 측이 key로 새로 만든다.
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

  const active = !!boards?.some(({ status }) => status === 'queued' || status === 'running')
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => void refreshBoards(), POLL_MS)
    return () => clearInterval(timer)
  }, [active, refreshBoards])

  const formError = form ? serialSettingsError(form) : null
  const dirty = !!form && !!saved && !same(form, saved)
  const canSave = dirty && !formError && !saving
  const runBlock = serialRunBlock(saved, boards)

  const change = (update: (current: SerialSettings) => SerialSettings) => {
    setForm((current) => current && update(current))
    setNotice(undefined)
  }

  async function save() {
    if (!form || !canSave || busy.current) return
    busy.current = true
    setSaving(true)
    setNotice(undefined)
    let ok = false
    try {
      const result = await useCase.saveSettings(workId, form, leaving.current?.signal)
      if (leaving.current?.signal.aborted) return
      setSaved(result)
      setForm(result)
      setNotice({ ok: true, text: '설정을 저장했어요.' })
      ok = true
    } catch (failure) {
      if (!leaving.current?.signal.aborted) setNotice({ ok: false, text: messageOf(failure, '설정을 저장하지 못했어요.') })
    } finally {
      busy.current = false
      setSaving(false)
    }
    // 저장하면 게시판이 열릴 수 있어 기록도 서버 값으로 다시 읽는다.
    if (ok) await refreshBoards()
  }

  async function run() {
    if (runBlock || busy.current) return
    busy.current = true
    setRunning(true)
    setNotice(undefined)
    try {
      await useCase.run(workId, leaving.current?.signal)
      if (!leaving.current?.signal.aborted) setNotice({ ok: true, text: '실행을 요청했어요. 곧 집필이 시작돼요.' })
    } catch (failure) {
      if (!leaving.current?.signal.aborted) setNotice({ ok: false, text: messageOf(failure, '실행을 요청하지 못했어요.') })
    } finally {
      busy.current = false
      setRunning(false)
    }
    // 요청이 받아졌든 거절됐든 서버가 지금 보는 상태를 다시 보인다.
    await refreshBoards()
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
    /** 지금 마감·실행을 못 하는 이유. null이면 할 수 있다. */
    runBlock,
    edit: (patch: Partial<SerialSettings>) => change((current) => ({ ...current, ...patch })),
    toggleDay: (day: SerialDay) => change((current) => ({ ...current, days: current.days.includes(day) ? current.days.filter((d) => d !== day) : [...current.days, day] })),
    save, run, refreshBoards, reload,
  }
}

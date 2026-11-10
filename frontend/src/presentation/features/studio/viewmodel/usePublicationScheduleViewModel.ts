import { useCallback, useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import { resultReloadDelay, toKstDateTimeInput, type PublicationSchedule } from '../../../../domain/entities/publicationSchedule'

type Operation = (signal: AbortSignal) => Promise<void>

const emptyForm = { versionId: '', time: '', rights: false }

export function usePublicationScheduleViewModel(workId: string, episode: number) {
  const api = appContainer.resolve('episodeUseCase')
  const [rows, setRows] = useState<PublicationSchedule[] | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef<AbortController | null>(null)
  const rereadAfter = useRef<Operation | null>(null)
  const pending = rows?.find(row => row.status === 'pending')
  const dueAt = pending?.scheduledAt

  const run = useCallback(async (operation: Operation, keepMessages = false) => {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    if (!keepMessages) {
      setError('')
      setNotice('')
    }
    try {
      await operation(controller.signal)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '예약 발행 요청을 처리하지 못했어요.')
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
        // 재조회 타이머가 이 요청 중에 울렸다면 방금 끝난 요청의 알림·오류를 남긴 채 한 번 다시 읽는다.
        const next = rereadAfter.current
        rereadAfter.current = null
        if (next) void run(next, true)
      }
    }
  }, [])

  const read = useCallback(async (signal: AbortSignal) => {
    const result = await api.publicationSchedules(workId, episode, signal)
    if (signal.aborted) return
    setRows(result)
    const reservation = result.find(row => row.status === 'pending')
    setForm(reservation ? { versionId: reservation.versionId, time: toKstDateTimeInput(reservation.scheduledAt), rights: false } : emptyForm)
  }, [api, workId, episode])

  useEffect(() => {
    void run(read)
    return () => {
      request.current?.abort()
      request.current = null
      rereadAfter.current = null
    }
  }, [read, run])

  // 예약 시각 직후 스케줄러가 처리한 결과를 한 번 다시 읽는다. 예약이 바뀌거나 화면을 떠나면 타이머를 지운다.
  useEffect(() => {
    const delay = dueAt === undefined ? null : resultReloadDelay(dueAt)
    if (delay === null) return
    const timer = setTimeout(() => {
      if (request.current) rereadAfter.current = read // 다른 요청이 진행 중이면 끝난 뒤 한 번 읽는다.
      else void run(read)
    }, delay)
    return () => clearTimeout(timer)
  }, [dueAt, read, run])

  return {
    rows, form, pending, busy, error, notice,
    edit: (patch: Partial<typeof emptyForm>) => setForm(current => ({ ...current, ...patch })),
    reload: () => run(read),
    save: () => run(async signal => {
      const result = await api.savePublicationSchedule(workId, episode, form.versionId, form.time, form.rights, pending, signal)
      if (signal.aborted) return
      setRows(current => [result, ...(current ?? []).filter(row => row.id !== result.id)])
      setForm({ versionId: result.versionId, time: toKstDateTimeInput(result.scheduledAt), rights: false })
      setNotice(pending ? '발행 예약을 변경했어요.' : '발행을 예약했어요.')
    }),
    cancel: () => run(async signal => {
      if (!pending) return
      await api.cancelPublicationSchedule(workId, episode, pending, signal)
      await read(signal)
      if (!signal.aborted) setNotice('발행 예약을 취소했어요.')
    }),
  }
}

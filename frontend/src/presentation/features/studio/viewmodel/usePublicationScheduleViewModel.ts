import { useCallback, useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import { toKstDateTimeInput, type PublicationSchedule } from '../../../../domain/entities/publicationSchedule'

const emptyForm = { versionId: '', time: '', rights: false }

export function usePublicationScheduleViewModel(workId: string, episode: number) {
  const api = appContainer.resolve('episodeUseCase')
  const [rows, setRows] = useState<PublicationSchedule[] | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef<AbortController | null>(null)
  const pending = rows?.find(row => row.status === 'pending')

  const run = useCallback(async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation(controller.signal)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '예약 발행 요청을 처리하지 못했어요.')
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
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
    }
  }, [read, run])

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

import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { BulkImportBasis, BulkImportResult, BulkUploadRow } from '../../../../domain/entities/manuscript'
import { BULK_SELECTION_LIMIT, type ManuscriptUseCase } from '../../../../domain/usecases/ManuscriptUseCase'

type PreviewRow = BulkUploadRow & { id: number }
const fileOrder = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })
const MAX_EPISODE_NUMBER = 2_147_483_647

export function useEpisodeBulkImport(
  workId: string,
  useCase: Pick<ManuscriptUseCase, 'bulkBasis' | 'importBulk'> = appContainer.resolve('manuscriptUseCase'),
) {
  const [basis, setBasis] = useState<BulkImportBasis | null>(null)
  const [basisAttempt, setBasisAttempt] = useState(0)
  const [files, setFiles] = useState<{ id: number; file: File }[]>([])
  const [start, setStart] = useState('')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [submitted, setSubmitted] = useState<PreviewRow[] | null>(null)
  const [results, setResults] = useState<Map<number, BulkImportResult>>(() => new Map())
  const [retryRevision, setRetryRevision] = useState<number | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stopReason, setStopReason] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void useCase.bulkBasis(workId, controller.signal).then((value) => {
      if (controller.signal.aborted) return
      setBasis(value)
      setStart(String(value.lastNumber + 1))
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '회차 정보를 읽지 못했어요.')
      }
    })
    return () => {
      controller.abort()
      active.current?.abort()
    }
  }, [workId, useCase, basisAttempt])

  const startNumber = Number(start)
  const validRange = !!basis && Number.isInteger(startNumber) && startNumber >= 1 &&
    startNumber <= basis.lastNumber + 1 && startNumber + files.length - 1 <= MAX_EPISODE_NUMBER
  const rows = submitted ?? files.map(({ id, file }, index) => ({
    id, file, number: validRange ? startNumber + index : 0,
    title: file.name.replace(/\.(txt|epub)$/i, '').trim(),
  }))
  const failedRows = submitted?.filter(({ number }) => results.get(number)?.status === 'failed') ?? []
  const savedCount = results.size - failedRows.length
  const editable = basis !== null && submitted === null && !busy
  const canStart = editable && validRange && rightsConfirmed && rows.length > 0
  const canRetry = !busy && stopReason === null && failedRows.length > 0

  function selectFiles(selection: FileList | File[]) {
    if (!editable || active.current || !selection.length) return false
    if (selection.length > BULK_SELECTION_LIMIT) {
      setError('회차 파일은 한 번에 최대 1,000개까지 선택할 수 있어요.')
      return false
    }
    setFiles(Array.from(selection).sort((a, b) => fileOrder.compare(a.name, b.name))
      .map((file, id) => ({ file, id })))
    setRightsConfirmed(false)
    setError('')
    return true
  }

  function move(id: number, direction: -1 | 1) {
    if (!editable || active.current) return
    setFiles((previous) => {
      const from = previous.findIndex((item) => item.id === id)
      const to = from + direction
      if (from < 0 || to < 0 || to >= previous.length) return previous
      const next = [...previous]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })
  }

  function replaceFailed(number: number, file: File) {
    if (!canRetry || active.current || results.get(number)?.status !== 'failed') return
    setSubmitted((previous) => previous?.map((row) => row.number === number ? { ...row, file } : row) ?? null)
    setRightsConfirmed(false)
    setError('')
  }

  async function send(target: PreviewRow[], first: boolean) {
    const revision = first ? basis?.workRevision : retryRevision
    if (active.current || revision == null) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError('')
    setProgress({ done: 0, total: target.length })
    if (first) setSubmitted(target)

    function apply(received: readonly BulkImportResult[]) {
      if (controller.signal.aborted) return
      setResults((previous) => {
        const next = new Map(previous)
        for (const result of received) next.set(result.number, result)
        return next
      })
      setProgress({ done: received.length, total: target.length })
    }

    try {
      const response = await useCase.importBulk(workId, target, rightsConfirmed, revision, apply, controller.signal)
      if (controller.signal.aborted) return
      apply(response.results)
      setRetryRevision(response.workRevision)
      setStopReason(response.stopReason)
    } catch (cause: unknown) {
      if (controller.signal.aborted) return
      if (first) setSubmitted(null)
      setProgress(null)
      setError(cause instanceof Error ? cause.message : '업로드를 시작하지 못했어요.')
    } finally {
      active.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return {
    basis, rows, start, setStart, rightsConfirmed, setRightsConfirmed,
    editable, busy, error, stopReason, progress, results, savedCount,
    failedCount: failedRows.length, canStart, canRetry,
    selectFiles, move, replaceFailed,
    refreshBasis: () => { setError(''); setBasisAttempt((value) => value + 1) },
    submit: () => canStart ? send(rows, true) : undefined,
    retryFailed: () => canRetry && rightsConfirmed ? send(failedRows, false) : undefined,
  }
}

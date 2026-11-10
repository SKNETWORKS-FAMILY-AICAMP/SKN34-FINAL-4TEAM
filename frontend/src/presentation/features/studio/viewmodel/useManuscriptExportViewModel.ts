import { useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { ManuscriptExportQuery } from '../../../../domain/entities/manuscript'
import type { ManuscriptUseCase } from '../../../../domain/usecases/ManuscriptUseCase'

/** 집필실 내보내기: 서버가 만든 TXT·EPUB을 받아 브라우저 다운로드로 넘긴다. `episode`가 null이면 현재 회차 범위는 쓸 수 없다. */
export function useManuscriptExportViewModel(
  workId: string,
  episode: number | null,
  api: Pick<ManuscriptUseCase, 'exportManuscript'> = appContainer.resolve('manuscriptUseCase'),
) {
  const [format, setFormat] = useState<ManuscriptExportQuery['format']>('txt')
  const [source, setSource] = useState<ManuscriptExportQuery['source']>('draft')
  const [wanted, setScope] = useState<'episode' | 'work'>('episode')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const scope = episode === null ? 'work' : wanted

  return {
    format, setFormat, source, setSource, scope, setScope,
    busy, error, notice,
    download: async () => {
      if (pending.current) return false
      const controller = new AbortController()
      pending.current = controller
      setBusy(true)
      setError('')
      setNotice('')
      try {
        const file = await api.exportManuscript(workId, scope === 'episode' && episode !== null ? { format, source, episode } : { format, source }, controller.signal)
        if (controller.signal.aborted) return false
        const url = URL.createObjectURL(file.blob)
        const link = document.createElement('a')
        link.href = url
        link.download = file.filename
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setNotice(`${file.filename} 다운로드를 요청했어요.`)
        return true
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '내보내지 못했어요. 잠시 후 다시 시도해 주세요.')
        return false
      } finally {
        if (pending.current === controller) {
          pending.current = null
          if (!controller.signal.aborted) setBusy(false)
        }
      }
    },
    cancel: () => {
      pending.current?.abort()
      pending.current = null
      setBusy(false)
      setError('내보내기를 취소했어요.')
    },
  }
}

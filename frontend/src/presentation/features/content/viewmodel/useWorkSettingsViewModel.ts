import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { WorkSettings, WritingMode } from '../../../../domain/entities/operatingSettings'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

/** onSaved는 집필 방식 저장이 성공했을 때 부른다: AI 자율 집필을 저장하면 서버가 AI 집필(원고 잠금)을 켜고 끄므로 호출 측이 그 상태를 다시 읽는다. */
export function useWorkSettingsViewModel(id: string, api: EpisodeUseCase = appContainer.resolve('episodeUseCase'), onSaved?: () => void) {
  const [settings, setSettings] = useState<WorkSettings>()
  const [mode, setMode] = useState<WritingMode | ''>('')
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef<AbortController | null>(null)

  useEffect(() => {
    setSaving(false)
    const read = new AbortController()
    api.workSettings(id, read.signal).then((result) => {
      if (read.signal.aborted) return
      setSettings(result)
      setMode(result.current.writingMode ?? '')
    }).catch((failure: unknown) => {
      if (!read.signal.aborted) setError(failure instanceof Error ? failure.message : '운영 설정을 불러오지 못했어요.')
    })
    return () => {
      read.abort()
      pending.current?.abort()
      pending.current = null
    }
  }, [id, api, attempt])

  const canSave = !!settings && !!mode && mode !== settings.current.writingMode && !saving
  async function save() {
    if (!canSave || !settings || !mode || pending.current) return
    const request = new AbortController()
    pending.current = request
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await api.updateWorkSettings(id, settings.current.revision, mode, request.signal)
      if (request.signal.aborted) return
      setSettings(result)
      setMode(result.current.writingMode ?? '')
      setNotice('집필 방식을 저장했어요.')
      onSaved?.()
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : '집필 방식을 저장하지 못했어요.')
    } finally {
      if (pending.current === request) {
        pending.current = null
        setSaving(false)
      }
    }
  }

  function reload() {
    setSettings(undefined)
    setError('')
    setNotice('')
    setAttempt((count) => count + 1)
  }

  function selectMode(value: WritingMode | '') {
    setMode(value)
    setNotice('')
  }

  return { settings, mode, selectMode, saving, error, notice, canSave, save, reload }
}

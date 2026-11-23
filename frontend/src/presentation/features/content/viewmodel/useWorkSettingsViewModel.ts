import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { WorkSettings, WritingMode } from '../../../../domain/entities/operatingSettings'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

/**
 * onSaved는 집필 방식 저장이 성공했을 때 부른다: AI 자율 집필을 저장하면 서버가 AI 집필(원고 잠금)을 켜고 끄므로 호출 측이 그 상태를 다시 읽는다.
 * AI 자율 집필을 새로 저장할 때는 인물 카드 경고 확인(confirming)을 먼저 거친다(계약 'AI 자율 집필 선택 경고'): save는 확인을 열고, confirmSave(계속 저장)가 그때 저장하며 cancelConfirm(취소)은 저장하지 않는다.
 * 경고일 뿐 저장을 막지 않는다. 이미 AI 자율 집필인 작품은 저장값과 같은 값이라 저장이 잠겨(canSave) 확인도 열리지 않는다.
 */
export function useWorkSettingsViewModel(id: string, api: EpisodeUseCase = appContainer.resolve('episodeUseCase'), onSaved?: () => void) {
  const [settings, setSettings] = useState<WorkSettings>()
  const [mode, setMode] = useState<WritingMode | ''>('')
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirming, setConfirming] = useState(false)
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
  /** 집필 방식 저장 버튼: AI 자율 집필은 확인을 열고(canSave가 저장값과 다른 값만 통과시킨다), 그 밖의 방식은 바로 저장한다. */
  async function save() {
    if (!canSave) return
    if (mode === 'autonomous') return setConfirming(true)
    await commit()
  }

  async function confirmSave() {
    if (!confirming) return
    setConfirming(false)
    await commit()
  }

  async function commit() {
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

  return { settings, mode, selectMode, saving, error, notice, canSave, confirming, save, confirmSave, cancelConfirm: () => setConfirming(false), reload }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { EpisodeWorldBasis, WorldBasisCard, WorldBasisVersion } from '../../../../domain/entities/episodeWorldBasis'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'

export function useEpisodeWorldBasisViewModel(workId: string, number: number) {
  const api = appContainer.resolve('episodeUseCase')
  const studio = appContainer.resolve('worldStudioUseCase')
  const [current, setCurrent] = useState<EpisodeWorldBasis | null>(null)
  const [worlds, setWorlds] = useState<StudioWorld[]>([])
  const [versions, setVersions] = useState<WorldBasisVersion[] | null>(null)
  const [cards, setCards] = useState<WorldBasisCard[] | null>(null)
  const [worldId, setWorldId] = useState('')
  const [revisionId, setRevisionId] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef<AbortController | null>(null)
  const world = worlds.find(row => row.id === worldId)

  const run = useCallback(async (action: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return
    const request = new AbortController()
    pending.current = request
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action(request.signal)
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : '기준 세계관을 확인할 수 없어요.')
    } finally {
      if (pending.current === request) {
        pending.current = null
        setBusy(false)
      }
    }
  }, [])

  const reload = useCallback(() => run(async signal => {
    const [basis, owned] = await Promise.all([api.episodeWorldBasis(workId, number, signal), studio.list(signal)])
    if (signal.aborted) return
    setCurrent(basis)
    setWorlds(owned)
    setWorldId(basis.basis?.worldId ?? '')
    setRevisionId(basis.basis?.revisionId ?? '')
    setVersions(null)
    setCards(null)
    if (basis.basis) {
      const rows = await api.worldBasisVersions(basis.basis.worldId, signal)
      if (!signal.aborted) setVersions(rows)
    }
  }), [api, studio, workId, number, run])

  useEffect(() => {
    void reload()
    return () => { pending.current?.abort(); pending.current = null }
  }, [reload])

  return {
    current, worlds, versions, cards, world, worldId, revisionId, busy, error, notice, reload,
    toggleCards: () => run(async signal => {
      if (cards) { setCards(null); return }
      const basis = current?.basis
      if (!basis) return
      const rows = await api.worldBasisCards(basis.worldId, basis.revisionId, signal)
      if (!signal.aborted) setCards(rows)
    }),
    chooseVersion: setRevisionId,
    chooseWorld: (id: string) => run(async signal => {
      setWorldId(id)
      setRevisionId('')
      setVersions(null)
      if (!id) return
      const rows = await api.worldBasisVersions(id, signal)
      if (!signal.aborted) setVersions(rows)
    }),
    choose: () => run(async signal => {
      if (!current || !versions?.some(version => version.revisionId === revisionId)) return
      const saved = await api.chooseEpisodeWorldBasis(workId, number, { worldId, revisionId, revision: current.revision }, signal)
      if (signal.aborted) return
      setCurrent(saved)
      setCards(null)
      setNotice('회차의 기준 세계관을 저장했어요.')
    }),
    confirm: () => run(async signal => {
      if (!world || world.relationshipStatus !== 'current') return
      const id = await api.confirmWorldBasisVersion(world.id, world.version, `episode-basis:${world.version}`, signal)
      const [rows, owned] = await Promise.all([api.worldBasisVersions(world.id, signal), studio.list(signal)])
      if (signal.aborted) return
      if (!rows.some(row => row.revisionId === id)) throw new Error('확정 버전이 목록에 없습니다. 다시 불러와 주세요.')
      setWorlds(owned)
      setVersions(rows)
      setRevisionId(id)
      setNotice('세계관을 확정했어요. 이 회차의 기준으로 선택할 수 있어요.')
    }),
  }
}

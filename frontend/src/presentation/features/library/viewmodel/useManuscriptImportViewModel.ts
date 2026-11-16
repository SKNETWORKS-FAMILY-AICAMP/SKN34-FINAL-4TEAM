import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import type { AdjustableEpisode, ManuscriptImportSummary } from '../../../../domain/entities/manuscript'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { adjustableEpisodes, mergeWithNext, type ManuscriptUseCase } from '../../../../domain/usecases/ManuscriptUseCase'
import { useServerWorks } from './useServerWorks'

type ManuscriptApi = Pick<ManuscriptUseCase, 'preview' | 'confirm'>
type Plan = { format: 'txt' | 'epub'; existingEpisodeCount: number; episodes: AdjustableEpisode[] }
type Busy = 'preview' | 'confirm' | null

const noRights = [false, false, false]
const titleOk = (episode: AdjustableEpisode) => episode.excluded || (!!episode.title.trim() && episode.title.length <= 120)

/** 실제 `/import`: 작품 선택 → 권리 확인 → 파일 미리보기 → 회차 조정 → 확정 → 회차별 결과. 서버에는 아무것도 임시 저장하지 않는다. */
export function useManuscriptImportViewModel(
  api: ManuscriptApi = appContainer.resolve('manuscriptUseCase'),
  workApi: Pick<EpisodeUseCase, 'list'> = appContainer.resolve('episodeUseCase'),
) {
  const { works, loading: worksLoading, error: worksError, reload: reloadWorks } = useServerWorks(workApi)
  const [params] = useSearchParams()
  const [chosen, setChosen] = useState<string | null>(null)
  const [rights, setRights] = useState(noRights)
  const [file, setFile] = useState<File | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [result, setResult] = useState<ManuscriptImportSummary | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])

  // 직접 고르기 전에는 ?work= 로 넘어온 내 작품만 미리 고른다.
  const workId = chosen ?? works.find((work) => work.id === params.get('work'))?.id ?? ''
  const hasImportInput = Boolean(chosen || file || rights.some(Boolean))
  const allRights = rights.every(Boolean)
  const included = plan?.episodes.filter((episode) => !episode.excluded).length ?? 0
  const canPreview = !!workId && allRights && !!file && !busy
  const canConfirm = !!plan && !!file && !!workId && !busy && allRights && included > 0 && plan.episodes.every(titleOk)

  const run = async (kind: Exclude<Busy, null>, action: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return false
    const controller = new AbortController()
    pending.current = controller
    setBusy(kind)
    setError('')
    try {
      await action(controller.signal)
      return !controller.signal.aborted
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '요청을 처리하지 못했어요. 입력은 그대로 남겨 두었어요.')
      return false
    } finally {
      if (pending.current === controller) {
        pending.current = null
        if (!controller.signal.aborted) setBusy(null)
      }
    }
  }
  const forget = () => { setPlan(null); setResult(null); setError('') }
  const edit = (change: (episodes: AdjustableEpisode[]) => AdjustableEpisode[]) => setPlan((current) => current && { ...current, episodes: change(current.episodes) })

  return {
    works, worksLoading, worksError, reloadWorks,
    workId,
    confirmLeave: () => !hasImportInput || window.confirm('이동하면 지금까지 입력한 원고 정보와 회차 조정 내용이 사라져요. 이동할까요?'),
    selectWork: (id: string) => { if (pending.current) return; setChosen(id); forget() },
    rights, allRights,
    setRight: (index: number, checked: boolean) => setRights((current) => current.map((value, i) => i === index ? checked : value)),
    file,
    pickFile: (next: File | null) => { if (pending.current) return; setFile(next); forget() },
    canPreview,
    preview: async () => {
      if (!canPreview || !file) return false
      return run('preview', async (signal) => {
        const value = await api.preview(workId, file, signal)
        if (signal.aborted) return
        setPlan({ format: value.format, existingEpisodeCount: value.existingEpisodeCount, episodes: adjustableEpisodes(value) })
      })
    },
    plan, included,
    setTitle: (index: number, title: string) => edit((list) => list.map((episode, i) => i === index ? { ...episode, title } : episode)),
    setExcluded: (index: number, excluded: boolean) => edit((list) => list.map((episode, i) => i === index ? { ...episode, excluded } : episode)),
    mergeNext: (index: number) => edit((list) => mergeWithNext(list, index)),
    canConfirm,
    confirm: async () => {
      if (!canConfirm || !plan || !file) return false
      return run('confirm', async (signal) => {
        const value = await api.confirm(workId, file, allRights, plan.episodes, signal)
        if (!signal.aborted) setResult(value)
      })
    },
    result, busy, error,
    cancel: () => {
      pending.current?.abort()
      pending.current = null
      setBusy(null)
      setError(busy === 'confirm' ? '등록 요청을 취소했어요. 서버에서 이미 처리했을 수 있어요. 집필실에서 회차를 확인해 주세요.' : '미리보기 요청을 취소했어요.')
    },
    reset: () => { setFile(null); setRights(noRights); forget() },
  }
}

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { publicCast, visibleEpisode } from '../../../../domain/entities/work'
import type { ForkUseCase } from '../../../../domain/usecases/ForkUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 fork(id)·startFork: U09 포크 3단계 폼 */
export function useForkViewModel(id: string, queryAt: number, forkUseCase: ForkUseCase = appContainer.resolve('forkUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { data } = useAsyncData(() => forkUseCase.getForm(id), [forkUseCase, id])
  const [picked, setPicked] = useState<number | null>(null)
  const [dir, setDir] = useState(id === 'guunmong' ? '성진이 흔들린 마음을 숨기지 않고 스승에게 털어놓았다면?' : '')
  const [title, setTitle] = useState<string | null>(null)
  const [historyConsent, setHistoryConsent] = useState(false)
  const busy = useRef(false)
  useScreenId(data ? 'U09' : null)

  const w = data?.work
  const shownTitle = title ?? (w ? `${w.title}: ${id === 'guunmong' ? '연화봉에 남은 성진' : ''}` : '')
  const at = picked ?? (data?.forkList.includes(queryAt) ? queryAt : data?.forkList[0] ?? 0)
  return {
    form: data,
    episodes: w ? w.eps.map((e, i) => ({ e, n: i + 1, ok: data.forkList.includes(i + 1) })).filter(({ e }) => visibleEpisode(w, e, role)) : [],
    at,
    pick: setPicked,
    ruleCount: w ? w.rules.filter((r) => !(w.ruleFrom && w.ruleFrom[r] > at)).length : 0,
    castCount: w ? publicCast(w, at).length : 0,
    dir, setDir,
    title: shownTitle,
    setTitle,
    historyConsent, setHistoryConsent,
    start: async () => {
      if (busy.current) return
      busy.current = true
      const r = await forkUseCase.startFork(id, at, { dir, title: shownTitle, historyConsent }).finally(() => { busy.current = false })
      if ('error' in r) return toast(r.error)
      dispatch(sessionActions.dataChanged())
      toast('원작 ' + at + '화 시점을 복사해 포크 소설을 만들었어요')
      navigate('/forked/' + r.id)
    },
  }
}

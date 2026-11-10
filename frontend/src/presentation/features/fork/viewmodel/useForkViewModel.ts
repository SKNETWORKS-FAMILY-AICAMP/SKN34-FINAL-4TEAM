import { useEffect, useRef, useState } from 'react'
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
  const [picked, setPicked] = useState<number | null>(null)
  // 회차를 고르면 그 회차의 설정을 다시 읽지만 폼은 그대로 둡니다(포커스·입력 유지). 범위는 작품·기준 주소입니다.
  const { data, isError, isRefreshing, retry } = useAsyncData(async () => {
    const form = await forkUseCase.getForm(id,picked??queryAt)
    // 서버가 고른 회차를 다른 회차로 바꿔 답했으면(허용 회차가 바뀜) 고른 값을 지워, 재조회 중에도 고른 값으로 깜빡이지 않고 서버가 정한 회차를 보입니다.
    // 그 사이 다른 회차를 새로 골랐다면 그 선택은 지우지 않습니다.
    if (form && picked !== null && form.basisEpisode !== picked) setPicked((current) => current === picked ? null : current)
    return form
  }, [forkUseCase, id, queryAt, role], [picked])
  const [dir, setDir] = useState('')
  const [title, setTitle] = useState<string | null>(null)
  const [historyConsent, setHistoryConsent] = useState(false)
  const busy = useRef(false)
  const generation = useRef(0)
  useEffect(() => () => { generation.current += 1 }, [])
  const [submitting,setSubmitting] = useState(false)
  const [error,setError] = useState('')
  useScreenId(data ? 'U09' : null)

  const w = data?.work
  const shownTitle = title ?? (w ? `${w.title}: ` : '')
  // 서버 작품은 고른 회차의 설정을 읽는 동안 이전 회차의 개수를 새 회차 값처럼 보이지 않습니다.
  const reading = isRefreshing && !!w?.canonical
  const at = (isRefreshing ? picked : null) ?? data?.basisEpisode ?? 0
  const preview = w?.wiki?.docs
  return {
    form: data, isError, retry, submitting, error,
    episodes: w ? w.eps.map((e, i) => ({ e, n: i + 1, ok: data.forkList.includes(i + 1) })).filter(({ e }) => visibleEpisode(w, e, role)) : [],
    at, preview, reading,
    pick: setPicked,
    ruleCount: w && !reading ? w.rules.filter((r) => !(w.ruleFrom && w.ruleFrom[r] > at)).length : null,
    castCount: w && !reading ? publicCast(w, at).length : null,
    dir, setDir,
    title: shownTitle,
    setTitle,
    historyConsent, setHistoryConsent,
    start: async () => {
      if (busy.current || reading) return
      busy.current = true; setSubmitting(true); setError('')
      const request = generation.current
      try {
        const r = await forkUseCase.startFork(id, at, { dir, title: shownTitle, historyConsent })
        if (request !== generation.current) return
        if ('error' in r) { setError(r.error); toast(r.error); return }
        dispatch(sessionActions.dataChanged())
        toast(w?.canonical?'서버에 포크 소설을 만들었어요':'원작 '+at+'화 시점을 복사해 포크 소설을 만들었어요')
        navigate('/forked/' + r.id)
      } catch(error) { if (request === generation.current) setError(error instanceof Error?error.message:'포크 생성에 실패했어요. 저장 여부를 다시 확인해 주세요.') }
      finally { busy.current=false; if (request === generation.current) setSubmitting(false) }
    },
  }
}

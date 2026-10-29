import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch } from '../../../../app/store'
import type { LibraryUseCase } from '../../../../domain/usecases/LibraryUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAiDemo } from '../../../shared/useAiDemo'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 importer()·IMP: U24 예시 원고 가져오기 (실제 파일 전송·AI 처리 없음) */
export function useImportViewModel(libraryUseCase: LibraryUseCase = appContainer.resolve('libraryUseCase')) {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const aiDemo = useAiDemo()
  const { data } = useAsyncData(() => libraryUseCase.getWorlds(), [libraryUseCase])
  const [step, setStep] = useState(-1)
  const [picked, setPicked] = useState(false)
  const [kind, setKind] = useState('다른 사람 소설')
  const [ok, setOk] = useState(false)
  const [world, setWorld] = useState('')
  const timer = useRef<number | undefined>(undefined)
  useScreenId('U24')
  useEffect(() => () => window.clearInterval(timer.current), [])

  const run = async (task: string) => {
    if (!await aiDemo(task, 10)) return
    setStep(0)
    window.clearInterval(timer.current)
    timer.current = window.setInterval(() => setStep((s) => {
      if (s + 1 >= 5) window.clearInterval(timer.current)
      return s + 1
    }), 420)
  }
  return {
    myWorlds: data?.mine ?? [],
    step, done: step >= 5, running: step >= 0 && step < 5,
    picked, pick: () => setPicked(true),
    kind, setKind, ok, setOk, world, setWorld,
    start: () => {
      if (!data?.mine.some((w) => w.id === world)) return toast('연결할 내 세계관을 선택해 주세요')
      if (!ok) return toast('AI로 처리할 권리에 체크해 주세요')
      run('원고 설정 추출')
    },
    rerun: () => run('원고 설정 재추출'),
    save: async () => {
      const r = await libraryUseCase.saveImport({ kind, worldId: world })
      if ('error' in r) return toast(r.error)
      dispatch(sessionActions.dataChanged())
      toast('세계관·인물·사건을 저장했어요 (비공개 상태)')
      navigate('/lib?tab=write')
    },
  }
}

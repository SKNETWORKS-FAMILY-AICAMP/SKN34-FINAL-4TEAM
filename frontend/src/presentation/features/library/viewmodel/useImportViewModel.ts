import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import type { LibraryUseCase } from '../../../../domain/usecases/LibraryUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAiDemo } from '../../../shared/useAiDemo'
import { useAsyncData } from '../../../shared/useAsyncData'
import { importActions, type ImportList } from '../state/importSlice'

const STEP_MS = 420

/** 목업 importer()·IMP: U24 예시 원고 가져오기 (실제 파일 전송·AI 처리 없음) */
export function useImportViewModel(libraryUseCase: LibraryUseCase = appContainer.resolve('libraryUseCase')) {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const aiDemo = useAiDemo()
  const { data } = useAsyncData(() => libraryUseCase.getWorlds(), [libraryUseCase])
  const imp = useAppSelector((s) => s.import)
  const [now, setNow] = useState(Date.now)
  const step = imp.startedAt === null ? -1 : Math.min(5, Math.floor((now - imp.startedAt) / STEP_MS))
  useScreenId('U24')
  useEffect(() => {
    if (step < 0 || step >= 5) return
    const t = window.setInterval(() => setNow(Date.now()), STEP_MS / 4)
    return () => window.clearInterval(t)
  }, [step])

  const run = async (task: string) => {
    if (!await aiDemo(task, 10)) return
    const t = Date.now()
    setNow(t)
    dispatch(importActions.start(t))
  }
  return {
    myWorlds: data?.mine ?? [],
    step, done: step >= 5, running: step >= 0 && step < 5,
    picked: imp.picked, pick: () => dispatch(importActions.set({ picked: true })),
    kind: imp.kind, setKind: (kind: string) => dispatch(importActions.set({ kind })),
    ok: imp.ok, setOk: (ok: boolean) => dispatch(importActions.set({ ok })),
    world: imp.worldId, setWorld: (worldId: string) => dispatch(importActions.set({ worldId })),
    result: { cast: imp.cast, world: imp.world, events: imp.events },
    /** 목업 [data-ie] blur: 고친 항목을 정리 결과에 반영합니다. */
    edit: (list: ImportList, i: number, text: string) => dispatch(importActions.edit({ list, i, text: text.trim() })),
    start: () => {
      if (!data?.mine.some((w) => w.id === imp.worldId)) return toast('연결할 내 세계관을 선택해 주세요')
      if (!imp.ok) return toast('AI로 처리할 권리에 체크해 주세요')
      run('원고 설정 추출')
    },
    rerun: () => run('원고 설정 재추출'),
    save: async () => {
      const r = await libraryUseCase.saveImport({ kind: imp.kind, worldId: imp.worldId, cast: imp.cast, world: imp.world, events: imp.events })
      if ('error' in r) return toast(r.error)
      dispatch(sessionActions.dataChanged())
      toast('세계관·인물·사건을 저장했어요 (비공개 상태)')
      navigate('/lib?tab=write')
    },
  }
}

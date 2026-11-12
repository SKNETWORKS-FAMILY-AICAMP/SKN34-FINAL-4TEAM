import { useCallback } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { HOME_CHIPS, type ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { showRouteProgress } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { uiActions } from '../../../shared/ui/uiSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

export function useHomeViewModel(readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  // 홈이 쓰는 값만 하나씩 구독한다. s.ui를 통째로 읽으면 캐러셀 자동 넘김(4.5초마다)·화면 ID·보기 설정처럼 무관한 변경에도 홈 전체를 다시 그린다.
  const chip = useAppSelector((s) => s.ui.chip)
  const guide = useAppSelector((s) => s.ui.guide)
  const firstHome = useAppSelector((s) => s.ui.firstHome)
  const dispatch = useAppDispatch()
  const { data, isError, isLoading, retry } = useAsyncData(() => readingUseCase.getHome(role, chip), [readingUseCase, role, chip])
  useScreenId(chip === HOME_CHIPS[0][0] ? 'U01' : 'U02')
  return {
    home: data,
    isError, isLoading, retry,
    chips: HOME_CHIPS.map((c) => c[0]),
    chip,
    guide,
    firstHome,
    selectChip: (c: string) => { showRouteProgress(); dispatch(uiActions.setChip(c)) },
    closeGuide: () => dispatch(uiActions.closeGuide()),
    homeVisited: () => dispatch(uiActions.homeVisited()),
    markSeen: (id: string) => { void readingUseCase.markSeen(id).then(() => dispatch(sessionActions.dataChanged())) },
  }
}

/** 목업 S.hero: 캐러셀 위치와 이동·범위 보정. 캐러셀만 이 값을 구독하므로 자동 넘김이 홈의 다른 구역을 다시 그리지 않는다. */
export function useHeroViewModel() {
  const hero = useAppSelector((s) => s.ui.hero)
  const dispatch = useAppDispatch()
  // 캐러셀 effect가 렌더마다 타이머를 다시 걸지 않도록 고정합니다.
  const stepHero = useCallback((d: number) => { dispatch(uiActions.stepHero(d)) }, [dispatch])
  const setHero = useCallback((i: number) => { dispatch(uiActions.setHero(i)) }, [dispatch])
  return { hero, stepHero, setHero }
}

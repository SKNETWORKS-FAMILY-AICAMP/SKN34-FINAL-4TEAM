import { useCallback } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { HOME_CHIPS, type ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { showRouteProgress } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

export function useHomeViewModel(readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase')) {
  const { role, chip, guide, firstHome, hero } = useAppSelector((s) => s.session)
  const dispatch = useAppDispatch()
  const { data, isError } = useAsyncData(() => readingUseCase.getHome(role, chip), [readingUseCase, role, chip])
  useScreenId(chip === HOME_CHIPS[0][0] ? 'U01' : 'U02')
  // 캐러셀 effect가 렌더마다 타이머를 다시 걸지 않도록 고정합니다.
  const stepHero = useCallback((d: number) => { dispatch(sessionActions.stepHero(d)) }, [dispatch])
  const setHero = useCallback((i: number) => { dispatch(sessionActions.setHero(i)) }, [dispatch])
  return {
    home: data,
    isError,
    chips: HOME_CHIPS.map((c) => c[0]),
    chip,
    guide,
    firstHome,
    selectChip: (c: string) => { showRouteProgress(); dispatch(sessionActions.setChip(c)) },
    /** 목업 S.hero: 캐러셀 위치와 이동·범위 보정 */
    hero,
    stepHero,
    setHero,
    closeGuide: () => dispatch(sessionActions.closeGuide()),
    homeVisited: () => dispatch(sessionActions.homeVisited()),
    markSeen: (id: string) => { void readingUseCase.markSeen(id).then(() => dispatch(sessionActions.dataChanged())) },
  }
}

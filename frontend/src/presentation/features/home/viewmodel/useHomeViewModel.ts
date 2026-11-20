import { useCallback } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { HOME_CHIP_ALL, homeChips } from '../../../../domain/entities/genre'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
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
  // 칩 줄: 추천 · 홈에 보이는 장르(공개 장르 목록) · 무료 · 포크 많은. 목록을 읽는 동안·읽지 못했을 때는 장르 칩 없이 세 칩만 보이고 실패는 `chipsFailed`로 알린다.
  const chips = useAsyncData((signal) => readingUseCase.homeChips(signal), [readingUseCase])
  // 고른 칩이 더는 없는 칩(운영이 장르를 숨겼거나 홈 노출을 끔)이면 추천으로 본다. 칩 줄을 읽기 전에는 고른 값을 그대로 둔다.
  const active = chips.data && !chips.data.includes(chip) ? HOME_CHIP_ALL : chip
  const { data, isError, isLoading, retry } = useAsyncData(() => readingUseCase.getHome(role, active), [readingUseCase, role, active])
  useScreenId(active === HOME_CHIP_ALL ? 'U01' : 'U02')
  return {
    home: data,
    isError, isLoading, retry,
    chips: chips.data ?? homeChips([]),
    chipsFailed: chips.isError && !chips.data, retryChips: chips.retry,
    chip: active,
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

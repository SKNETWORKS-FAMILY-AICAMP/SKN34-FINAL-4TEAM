import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'

import { useAppDispatch, useAppSelector } from '../../../app/store'
import { uiActions } from '../ui/uiSlice'
import { dismissOnboarding, isOnboardingDismissed } from './onboardingPrefs'

/**
 * 첫 방문 안내(U46, #884): 홈(`/`)에서만, '다음부터 보지 않기'를 고른 채 닫은 적이 없을 때 연다.
 * 그냥 닫기(✕·Esc·작품 둘러보기·바로가기)와 다른 시트에 밀려 닫힌 경우는 이번 방문(앱을 새로 열기 전)만 닫고 저장하지 않는다. 이 기억은 스토어(ui.guide)에 둔다:
 * 안내가 그려지지 않는 화면(/status)을 거쳐도 풀리지 않고, 새로 고침하면 다시 연다.
 * 홈에 들어온 순간 다른 시트(정책 안내·빠른 이동 등)가 열려 있으면 그 시트를 밀어내지 않도록 이번에는 열지 않는다.
 */
export function useOnboardingViewModel() {
  const { pathname } = useLocation()
  const dispatch = useAppDispatch()
  const visitOpen = useAppSelector((s) => s.ui.guide)
  const [dismissed, setDismissed] = useState(isOnboardingDismissed)
  const [ready, setReady] = useState(false)
  const home = pathname === '/'
  useEffect(() => {
    setReady(home && !document.querySelector('[role=dialog],[role=alertdialog]'))
  }, [home])
  const skip = () => dispatch(uiActions.closeGuide())
  return {
    open: home && ready && visitOpen && !dismissed,
    skip,
    dismiss: () => { dismissOnboarding(); setDismissed(true); skip() },
  }
}

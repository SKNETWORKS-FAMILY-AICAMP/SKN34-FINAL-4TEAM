import { useState } from 'react'
import { useLocation } from 'react-router'

import { dismissOnboarding, isOnboardingDismissed } from './onboardingPrefs'

/**
 * 첫 방문 안내(U46, #884): 홈(`/`)에서만, '다시 보지 않기'를 누른 적이 없을 때 연다.
 * '건너뛰기'와 다른 시트에 밀려 닫힌 경우는 이번 방문(앱을 새로 열기 전)만 닫고 저장하지 않는다.
 */
export function useOnboardingViewModel() {
  const { pathname } = useLocation()
  const [closed, setClosed] = useState(isOnboardingDismissed)
  return {
    open: pathname === '/' && !closed,
    skip: () => setClosed(true),
    dismiss: () => { dismissOnboarding(); setClosed(true) },
  }
}

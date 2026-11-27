import { vi } from 'vitest'

import { dismissOnboarding } from '../presentation/shared/shell/onboardingPrefs'
import { markTourSeen, tourScreens } from '../presentation/shared/tour/tourPrefs'

/** Legacy demo integration tests opt in explicitly; production DI stays unseeded and HTTP-backed. */
vi.mock('../app/appContainer', async () => ({ appContainer: (await import('./fixtureContainer')).createFixtureContainer() }))

/** 앱 전체를 그리는 테스트는 홈(`/`)에서 시작하는 경우가 많다. 첫 방문 안내(U46, #884)가 화면을 덮지 않도록 '다음부터 보지 않기' 상태로 시작한다. 안내 자체는 OnboardingSheet.test.tsx가 검사한다. */
if (typeof localStorage !== 'undefined') dismissOnboarding()

/** 화면별 사용법 투어(#971)도 같은 이유로 아홉 화면 모두 '본 것'으로 시작한다. 투어 자체는 ScreenTour.test.tsx가 검사한다. */
if (typeof localStorage !== 'undefined') tourScreens.forEach(markTourSeen)

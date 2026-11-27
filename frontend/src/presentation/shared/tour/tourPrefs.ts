/*
 * 화면별 사용법 투어(#971)의 '이미 봤어요' 기억. 이 브라우저의 localStorage에만 남기고 서버에는 보내지 않는다(홈 첫 방문 안내 onboardingPrefs와 같은 규칙).
 * ponytail: 기기·브라우저마다 따로라 다른 기기에서는 다시 보인다. 계정마다 한 번이어야 하면 서버 저장이 필요하다.
 * 저장소가 막혀 있거나 가득 차도 투어는 계속 동작하도록 조용히 건너뛰고, 읽기 실패는 본 적이 없는 것으로 본다.
 */

/** 투어가 있는 화면: 작가 도구 넷(작품 관리·집필실·세계관 관리·설정 카드 작성). 키는 `storyfork.tour.<화면>`이고, 대상 요소는 `data-tour="<화면>-<이름>"`으로 가리킨다. */
export const tourScreens = ['manage', 'studio', 'world', 'card'] as const
export type TourScreen = (typeof tourScreens)[number]

export const tourKey = (screen: TourScreen) => `storyfork.tour.${screen}`

export function isTourSeen(screen: TourScreen): boolean {
  try { return localStorage.getItem(tourKey(screen)) === 'seen' } catch { return false }
}

export function markTourSeen(screen: TourScreen) {
  try { localStorage.setItem(tourKey(screen), 'seen') } catch { /* 저장소를 쓸 수 없다: 다음 방문에 다시 보인다 */ }
}
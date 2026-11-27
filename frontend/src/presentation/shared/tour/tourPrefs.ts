/*
 * 화면별 사용법 투어(#971)의 '이미 봤어요' 기억. 이 브라우저의 localStorage에만 남기고 서버에는 보내지 않는다(홈 첫 방문 안내 onboardingPrefs와 같은 규칙).
 * ponytail: 기기·브라우저마다 따로라 다른 기기에서는 다시 보인다. 계정마다 한 번이어야 하면 서버 저장이 필요하다.
 * 저장소가 막혀 있거나 가득 차도 투어는 계속 동작하도록 조용히 건너뛰고, 읽기 실패는 본 적이 없는 것으로 본다.
 */

/**
 * 투어가 있는 화면: 작가 도구 넷(작품 관리·집필실·세계관 관리·설정 카드 작성). 키는 `storyfork.tour.<화면>`(그 화면에 처음 들어올 때의 메뉴 소개)이고, 탭·패널 투어는 `storyfork.tour.<화면>.<탭>`이다.
 * 대상 요소는 `data-tour="<화면>-<이름>"`(탭·패널은 `<화면>-<탭>-<이름>`)으로 가리킨다.
 */
export type TourScreen = 'manage' | 'studio' | 'world' | 'card'

export const tourKey = (screen: TourScreen, tab?: string) => `storyfork.tour.${screen}${tab ? `.${tab}` : ''}`

/** 이 키의 값이 'off'면 모든 화면·탭을 본 것으로 본다. 앱 전체를 그리는 테스트(fixtureApp)와 QA가 키를 하나씩 적지 않고 투어를 끄는 스위치다. */
export const tourOffKey = 'storyfork.tour'

export function isTourSeen(screen: TourScreen, tab?: string): boolean {
  try { return localStorage.getItem(tourOffKey) === 'off' || localStorage.getItem(tourKey(screen, tab)) === 'seen' } catch { return false }
}

export function markTourSeen(screen: TourScreen, tab?: string) {
  try { localStorage.setItem(tourKey(screen, tab), 'seen') } catch { /* 저장소를 쓸 수 없다: 다음 방문에 다시 보인다 */ }
}

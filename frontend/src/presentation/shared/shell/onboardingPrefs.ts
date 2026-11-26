/*
 * 첫 방문 안내(#884)의 '다시 보지 않기' 기억. 이 브라우저의 localStorage에만 남기고 서버에는 보내지 않는다.
 * ponytail: 기기·브라우저마다 따로라 다른 기기에서는 다시 보인다. 계정마다 한 번이어야 하면 서버 저장이 필요하다.
 * 저장소가 막혀 있거나 가득 차도 안내는 계속 동작하도록 조용히 건너뛰고, 읽기 실패는 저장한 적이 없는 것으로 본다(relationPrefs와 같은 규칙).
 */
export const onboardingKey = 'storyfork.onboarding'

export function isOnboardingDismissed(): boolean {
  try { return localStorage.getItem(onboardingKey) === 'dismissed' } catch { return false }
}

export function dismissOnboarding() {
  try { localStorage.setItem(onboardingKey, 'dismissed') } catch { /* 저장소를 쓸 수 없다: 이번 방문만 닫힌다 */ }
}

/** 같은 화면의 id 대상으로 스크롤하고 포커스를 옮긴다. 움직임 줄이기 설정이면 부드럽게 스크롤하지 않는다. */
export function jumpTo(id: string) {
  const el = document.getElementById(id)
  el?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  el?.focus({ preventScroll: true })
}

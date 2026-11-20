const HIGHLIGHT = 'color-mix(in srgb, var(--nw-acc, var(--pri)) 22%, transparent)'

/**
 * 같은 화면의 id 대상으로 스크롤하고 포커스를 옮긴다. 움직임 줄이기 설정이면 부드럽게 스크롤하지 않는다. 대상이 접힌 문단(details) 안이면 펼친다.
 * [flash]이면 대상을 잠깐 강조한다(관계 문단으로 이동할 때, DEC-54): 움직임 줄이기 설정이면 서서히 사라지는 대신 같은 시간 동안 고정 색으로 둔다.
 */
export function jumpTo(id: string, flash = false) {
  const el = document.getElementById(id)
  if (!el) return
  for (let d = el.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
  el.focus({ preventScroll: true })
  if (flash) el.animate?.([{ backgroundColor: HIGHLIGHT }, { backgroundColor: calm ? HIGHLIGHT : 'transparent' }], { duration: 1600 })
}

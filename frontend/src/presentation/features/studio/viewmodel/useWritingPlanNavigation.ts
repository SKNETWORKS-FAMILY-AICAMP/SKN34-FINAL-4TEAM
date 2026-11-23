import { useEffect, useEffectEvent } from 'react'

/** Both editors confirm without clearing input. Only a completed navigation unmounts them. */
export function useWritingPlanNavigation(mayLeave: () => boolean, dirty: boolean, busy: boolean) {
  const confirm = useEffectEvent(mayLeave)
  useEffect(() => {
    const beforeLeave = (event: Event) => { if (!confirm()) event.preventDefault() }
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty || busy) event.preventDefault() }
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.hash && anchor.pathname === location.pathname && anchor.search === location.search) return
      if (!confirm()) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    const index = window.history.state?.idx
    const pop = (event: PopStateEvent) => {
      const next = event.state?.idx
      if (typeof index !== 'number' || typeof next !== 'number' || index === next) return
      if (!confirm()) { event.stopImmediatePropagation(); window.history.go(index - next) }
    }
    window.addEventListener('sf-before-leave', beforeLeave)
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)
    window.addEventListener('popstate', pop, true)
    return () => {
      window.removeEventListener('sf-before-leave', beforeLeave)
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', click, true)
      window.removeEventListener('popstate', pop, true)
    }
  }, [dirty, busy])
}

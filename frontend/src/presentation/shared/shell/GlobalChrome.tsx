import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

import { useAppDispatch, useAppSelector } from '../../../app/store'
import { screenLabel } from '../screenIds'
import { uiActions } from '../ui/uiSlice'
import { ThemeButton } from './ThemeButton'
import { useNotificationStream } from './useNotificationStream'
import { useApplyTheme } from './useTheme'

/** 목업 RB: 페이지 이동 바 */
function RouteBar() {
  const location = useLocation()
  const [state, setState] = useState<{ on: boolean; p: number; instant: boolean }>({ on: false, p: 0, instant: true })
  useEffect(() => {
    const timers: number[] = []
    const run = () => {
      timers.forEach(clearTimeout)
      const at = (ms: number, s: Partial<typeof state>) => timers.push(window.setTimeout(() => setState((x) => ({ ...x, ...s })), ms))
      setState({ on: true, p: 0, instant: true })
      at(16, { p: 8, instant: false })
      at(60, { p: 45 })
      at(140, { p: 72 })
      at(200, { p: 100 })
      at(480, { on: false })
      at(780, { p: 0, instant: true })
    }
    window.addEventListener('sf-progress', run)
    return () => { window.removeEventListener('sf-progress', run); timers.forEach(clearTimeout) }
  }, [])
  useEffect(() => {
    window.dispatchEvent(new Event('sf-progress'))
    window.scrollTo?.({ top: 0 })
  }, [location.pathname, location.search])
  return <div id="rbar" className={state.on ? 'on' : ''}><i style={{ clipPath: `inset(0 ${100 - state.p}% 0 0)`, transition: state.instant ? 'none' : undefined }} /></div>
}

function Toast() {
  const [message, setMessage] = useState<string | null>(null)
  const [key, setKey] = useState(0)
  useEffect(() => {
    let t = 0
    const show = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail)
      setKey((k) => k + 1)
      clearTimeout(t)
      t = window.setTimeout(() => setMessage(null), 2600)
    }
    window.addEventListener('sf-toast', show)
    return () => { window.removeEventListener('sf-toast', show); clearTimeout(t) }
  }, [])
  return <div id="toast" key={key} role="status" hidden={message === null}>{message}</div>
}

function TopButton() {
  const button = useRef<HTMLButtonElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const f = () => {
      const visible = scrollY > 600
      // 숨긴 버튼의 포커스·스크롤 위치를 React가 복원하지 않도록 먼저 해제한다.
      if (!visible) button.current?.blur()
      setOn(visible)
    }
    f()
    addEventListener('scroll', f, { passive: true })
    return () => removeEventListener('scroll', f)
  }, [])
  return <button ref={button} type="button" id="top" className={on ? 'on' : ''} hidden={!on} tabIndex={on ? 0 : -1} aria-label="맨 위로" onClick={() => scrollTo({ top: 0, behavior: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}>↑</button>
}

/** 목업 applyProx(): 마우스 근처 .prox 카드를 살짝 키웁니다. 터치 기기에서는 끕니다. */
function useProximity() {
  useEffect(() => {
    let fine = true
    let raf = 0
    let mx = -999
    let my = -999
    const apply = () => {
      raf = 0
      if (!fine) return
      for (const el of document.querySelectorAll<HTMLElement>('.prox')) {
        const b = el.getBoundingClientRect()
        if (b.bottom < 0 || b.top > innerHeight) continue
        const d = Math.hypot(mx - (b.left + b.width / 2), my - (b.top + b.height / 2))
        const t = Math.max(0, 1 - d / (Math.max(b.width, b.height) * 0.9 + 60))
        const inside = mx >= b.left && mx <= b.right && my >= b.top && my <= b.bottom
        el.style.transform = `translateY(${-(inside ? 6 : t * 2)}px) scale(${(1 + t * 0.035 + (inside ? 0.035 : 0)).toFixed(4)})`
        el.classList.toggle('near', inside)
      }
    }
    const move = (e: MouseEvent) => { mx = e.clientX; my = e.clientY; if (!raf) raf = requestAnimationFrame(apply) }
    const touch = () => {
      fine = false
      document.querySelectorAll<HTMLElement>('.prox').forEach((el) => { el.style.transform = ''; el.classList.remove('near') })
    }
    document.addEventListener('mousemove', move, { passive: true })
    addEventListener('touchstart', touch, { passive: true, once: true })
    return () => { document.removeEventListener('mousemove', move); removeEventListener('touchstart', touch); cancelAnimationFrame(raf) }
  }, [])
}

/** 모든 화면에 고정으로 붙는 요소: 이동 바·Toast·맨 위로·화면 ID·화면 조작 버튼 */
export function GlobalChrome() {
  useApplyTheme()
  useProximity()
  useNotificationStream()
  const { showSid, screen } = useAppSelector((s) => s.ui)
  const { pathname } = useLocation()
  const showTools = pathname !== '/login' && pathname !== '/me' && !pathname.startsWith('/me/') && !pathname.startsWith('/auth/')
  // 집필실(U13)은 화면 ID·테마 전환을 상단 더보기 메뉴에 두므로 오른쪽 아래에 떠 있는 버튼을 뺀다(화면 ID 표시줄은 그대로).
  const writing = screen.base === 'U13' && pathname.startsWith('/studio/')
  const dispatch = useAppDispatch()
  return (
    <>
      <RouteBar />
      <Toast />
      <TopButton />
      {showTools && <>{import.meta.env.DEV && <div id="sid" hidden={!showSid}>{screenLabel(screen.sheet ?? screen.base)}</div>}
      {!writing && <div className="screen-controls">
        {import.meta.env.DEV && <button type="button" className="btn sm" onClick={() => dispatch(uiActions.toggleSid())}>화면 ID {showSid ? '끄기' : '켜기'}</button>}
        {/* 관리자 화면은 상단바에 테마 버튼이 있어 떠 있는 버튼이 표를 가리지 않게 뺍니다. */}
        {pathname !== '/admin' && <ThemeButton className="btn sm" />}
      </div>}</>}
    </>
  )
}

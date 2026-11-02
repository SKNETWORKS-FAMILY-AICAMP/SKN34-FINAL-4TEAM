import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'

import { useAppDispatch, useAppSelector } from '../../../app/store'
import { screenLabel } from '../screenIds'
import { sessionActions } from '../session/sessionSlice'
import { ThemeButton } from './ThemeButton'
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
  const [on, setOn] = useState(false)
  useEffect(() => {
    const f = () => setOn(scrollY > 600)
    addEventListener('scroll', f, { passive: true })
    return () => removeEventListener('scroll', f)
  }, [])
  return <button type="button" id="top" className={on ? 'on' : ''} aria-label="맨 위로" onClick={() => scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>
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
  const { showSid, screen } = useAppSelector((s) => s.session)
  const dispatch = useAppDispatch()
  return (
    <>
      <RouteBar />
      <Toast />
      <TopButton />
      <div id="sid" hidden={!showSid}>{screenLabel(screen.sheet ?? screen.base)}</div>
      <div className="screen-controls">
        <button type="button" className="btn sm" onClick={() => dispatch(sessionActions.toggleSid())}>화면 ID {showSid ? '끄기' : '켜기'}</button>
        <ThemeButton className="btn sm" />
      </div>
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigationType } from 'react-router'

import { useAppDispatch, useAppSelector } from '../../../app/store'
import { toastDuration } from '../events'
import { screenLabel } from '../screenIds'
import { uiActions } from '../ui/uiSlice'
import { ThemeButton } from './ThemeButton'
import { useNotificationStream } from './useNotificationStream'
import { useApplyTheme } from './useTheme'

/** 같은 경로인데도 값이 바뀌면 화면 내용이 통째로 바뀌는 쿼리: 관리자 탭, 공지·이벤트 글, 작품 관리의 작품, 검색어. 다른 화면으로 넘어간 것으로 본다. */
const SCREEN_QUERY: Record<string, string> = { '/admin': 'tab', '/me/notice': 'id', '/me/event': 'id', '/content': 'work', '/search': 'q' }

/** 목업 RB: 페이지 이동 바 */
function RouteBar() {
  const location = useLocation()
  const navigationType = useNavigationType()
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
  }, [location.pathname, location.search])
  // 맨 위로 올리는 것은 다른 화면으로 넘어갈 때(경로나 SCREEN_QUERY의 값이 바뀌는 PUSH·REPLACE)뿐이다. 같은 화면의 탭·필터(그 밖의 쿼리 변경)는 보던 위치와 화면이 옮긴 초점을 지키고,
  // 뒤로·앞으로(POP)와 처음 들어온 화면(새로 고침 포함)은 브라우저의 위치 복원에 맡긴다.
  const query = SCREEN_QUERY[location.pathname]
  const screen = query ? `${location.pathname}?${new URLSearchParams(location.search).get(query) ?? ''}` : location.pathname
  const from = useRef(screen)
  useEffect(() => {
    if (from.current === screen) return
    from.current = screen
    if (navigationType !== 'POP') window.scrollTo?.({ top: 0 })
  }, [screen, navigationType])
  return <div id="rbar" className={state.on ? 'on' : ''}><i style={{ clipPath: `inset(0 ${100 - state.p}% 0 0)`, transition: state.instant ? 'none' : undefined }} /></div>
}

/**
 * 화면 아래 알림. role=status 노드 하나를 계속 두고 글자만 바꾼다: 알림마다 노드를 새로 끼우면(내용이 든 채 삽입되는 라이브 영역) 보조기기가 놓칠 수 있다.
 * 비어 있을 때의 hidden은 storyfork.css(#toast[hidden])가 display:none을 풀어, 화면에는 보이지 않는 빈 라이브 영역으로 남는다.
 * 머무는 시간은 글자 수에 비례한다(toastDuration). 떠 있는 것과 같은 글이 다시 오면 글자가 바뀌지 않아 다시 읽히지 않으므로, 한 번 비운 뒤 잠깐 있다가 다시 넣는다.
 */
function Toast() {
  const [message, setMessage] = useState<string | null>(null)
  const [shown, setShown] = useState(0)
  const node = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let t = 0
    const show = (e: Event) => {
      const text = String((e as CustomEvent<string>).detail)
      clearTimeout(t)
      const put = () => {
        setMessage(text)
        setShown((n) => n + 1)
        t = window.setTimeout(() => setMessage(null), toastDuration(text))
      }
      if (node.current?.textContent !== text) return put()
      setMessage(null)
      t = window.setTimeout(put, 50)
    }
    window.addEventListener('sf-toast', show)
    return () => { window.removeEventListener('sf-toast', show); clearTimeout(t) }
  }, [])
  // 노드를 다시 만들지 않으므로, 이미 떠 있는 알림의 글자가 바뀔 때는 등장 애니메이션만 다시 돌려 바뀐 것을 눈으로도 알린다.
  useEffect(() => { node.current?.getAnimations?.().forEach((animation) => { animation.cancel(); animation.play() }) }, [shown])
  return <div id="toast" ref={node} role="status" hidden={message === null}>{message}</div>
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

/** 목업 applyProx(): 마우스 근처 .prox 카드를 살짝 키웁니다. 터치 기기와 동작 줄이기 설정에서는 끕니다. */
function useProximity() {
  useEffect(() => {
    // 동작 줄이기에서는 전환이 꺼져 있어 카드가 마우스를 따라 뚝뚝 튄다. 아예 걸지 않는다.
    // ponytail: 화면이 떠 있는 동안 설정을 바꾸는 경우는 다음 화면 로드부터 반영된다. 필요하면 matchMedia change를 구독한다.
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
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
  // 데모 집필실의 '내 소설만 쓸 수 있어요' 화면도 U13이지만 더보기 메뉴가 없으므로 서버(UUID) 집필실에서만 숨긴다.
  const writing = screen.base === 'U13' && /^\/studio\/[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(pathname)
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

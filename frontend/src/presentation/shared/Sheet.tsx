import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useAppDispatch } from '../../app/store'
import { sessionActions } from './session/sessionSlice'

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])'

/**
 * 목업 #modal의 .back-dim 시트. 열리면 화면 ID를 시트 ID로 바꾸고 포커스를 가두며,
 * Esc·배경 클릭으로 닫히면 시트를 연 요소로 포커스를 돌려줍니다.
 */
export function Sheet({ sid, label, onClose, panelClass = 'sheet', children }: { sid: string; label: string; onClose: () => void; panelClass?: string; children: ReactNode }) {
  const dispatch = useAppDispatch()
  const panel = useRef<HTMLDivElement>(null)
  // 첫 렌더링 시점의 포커스(시트를 연 버튼)를 기억합니다.
  const opener = useRef(document.activeElement)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })

  useEffect(() => {
    const el = panel.current
    if (!el) return
    const back = opener.current
    dispatch(sessionActions.setSheetScreen(sid))
    // 처음 포커스는 data-autofocus 입력, 없으면 첫 조작 요소 (React autoFocus는 StrictMode 재실행에서 풀립니다)
    ;(el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close.current()
      if (e.key !== 'Tab') return
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!items.length) return e.preventDefault()
      const [first, last] = [items[0], items[items.length - 1]]
      if (e.shiftKey ? document.activeElement === first || !el.contains(document.activeElement) : document.activeElement === last) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      dispatch(sessionActions.setSheetScreen(null))
      if (back instanceof HTMLElement) back.focus()
    }
  }, [dispatch, sid])

  return createPortal(
    <div className="back-dim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={panel} className={panelClass} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</div>
    </div>,
    document.body,
  )
}

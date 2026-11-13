import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useAppDispatch } from '../../app/store'
import { uiActions } from './ui/uiSlice'

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary:not([tabindex="-1"]),[href],[tabindex]:not([tabindex="-1"])'

/**
 * 시트 안에서 지금 포커스를 받을 수 있는 요소. 숨긴 것(hidden·inert 안, 브라우저가 보이지 않는다고 답한 것)은 뺀다:
 * 숨은 파일 입력이 처음이나 마지막으로 잡히면 focus()가 아무 일도 하지 않아 Tab 순환이 끊긴다.
 */
const focusables = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => !item.closest('[hidden],[inert]') && (item.checkVisibility?.() ?? true))

/**
 * 목업 #modal의 .back-dim 시트. 열리면 화면 ID를 시트 ID로 바꾸고 포커스를 가두며,
 * Esc·배경 클릭으로 닫히면 시트를 연 요소로 포커스를 돌려줍니다.
 */
export function Sheet({ sid, label, onClose, panelClass = 'sheet', dimClass = 'back-dim', children }: { sid: string; label: string; onClose: () => void; panelClass?: string; dimClass?: string; children: ReactNode }) {
  const dispatch = useAppDispatch()
  const panel = useRef<HTMLDivElement>(null)
  // 첫 렌더링 시점의 포커스(시트를 연 버튼)를 기억합니다.
  const opener = useRef(document.activeElement)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  // 시트 안에서 누르기 시작한 손짓인지. 입력 글자를 끌어 고르다 배경에서 떼면 브라우저가 click을 공통 조상인 배경에 보내므로, 누른 곳으로 닫을지 정한다.
  const pressedInside = useRef(false)

  useEffect(() => {
    const el = panel.current
    if (!el) return
    const back = opener.current
    // 목업 #modal은 슬롯이 하나라서 새 시트가 열리면 이전 시트를 닫습니다.
    window.dispatchEvent(new Event('sf-sheet-open'))
    const replaced = () => close.current()
    window.addEventListener('sf-sheet-open', replaced)
    dispatch(uiActions.setSheetScreen(sid))
    // 처음 포커스는 data-autofocus 입력, 없으면 첫 조작 요소 (React autoFocus는 StrictMode 재실행에서 풀립니다)
    ;(el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(el)[0] ?? el).focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 한글 조합 중 Esc는 조합을 취소하는 키다(Safari는 isComposing 없이 keyCode 229로 보낸다). 시트까지 닫으면 쓰던 글을 잃는다.
        if (e.isComposing || e.keyCode === 229) return
        return close.current()
      }
      if (e.key !== 'Tab') return
      const items = focusables(el)
      if (!items.length) return e.preventDefault()
      const [first, last] = [items[0], items[items.length - 1]]
      const at = document.activeElement
      // 시트 자체(빈 곳을 눌러 포커스가 패널에 있을 때)나 시트 밖에서의 Shift+Tab도 마지막 요소로 보내 뒤 화면으로 새지 않게 한다.
      if (e.shiftKey ? at === first || at === el || !el.contains(at) : at === last) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      window.removeEventListener('sf-sheet-open', replaced)
      // 교체로 닫힐 때는 새 시트의 화면 ID와 포커스를 지키고 opener로 돌리지 않습니다.
      if ([...document.querySelectorAll('[role=dialog]')].some((d) => d !== el)) return
      dispatch(uiActions.setSheetScreen(null))
      if (back instanceof HTMLElement) back.focus()
    }
  }, [dispatch, sid])

  return createPortal(
    <div className={dimClass}
      onPointerDown={(e) => { pressedInside.current = e.target !== e.currentTarget }}
      onClick={(e) => {
        const inside = pressedInside.current
        pressedInside.current = false
        if (e.target === e.currentTarget && !inside) onClose()
      }}>
      <div ref={panel} className={panelClass} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</div>
    </div>,
    document.body,
  )
}

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import './pop-menu.css'

const ITEMS = '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])'

/**
 * 아이콘 버튼 하나가 여는 작은 메뉴(popover)다. 바깥 클릭·Escape·Tab·항목 선택으로 닫히고, 닫히면 초점이 버튼으로 돌아온다.
 * 항목은 쓰는 쪽이 role="menuitem"으로 그린다(↑↓·Home·End로 옮긴다). 버튼 모양과 열리는 방향은 className으로 정한다.
 */
export function PopMenu({ label, icon, className = '', children }: { label: string; icon: ReactNode; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = () => [...(root.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])]
  const close = () => { setOpen(false); trigger.current?.focus() }

  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    // 목록이 fixed라 버튼에 묶이지 않았다면(스크롤하는 회차 목록 안의 메뉴) 스크롤 뒤 다른 항목 옆에 남아 대상이 헷갈리므로 닫는다.
    const scrolled = () => { const list = root.current?.querySelector('[role="menu"]'); if (list && getComputedStyle(list).position === 'fixed') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('scroll', scrolled, true)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('scroll', scrolled, true) }
  }, [open])

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' && e.target === trigger.current) { e.preventDefault(); setOpen(true) }
      return
    }
    // Tab은 막지 않는다: 초점을 버튼에 두고 닫으면 브라우저가 거기서 다음 요소로 옮긴다.
    if (e.key === 'Escape' || e.key === 'Tab') return close()
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const list = items()
    const at = list.findIndex(el => el === document.activeElement)
    const last = list[list.length - 1]
    const next = e.key === 'Home' ? list[0] : e.key === 'End' ? last : e.key === 'ArrowDown' ? list[at + 1] ?? list[0] : list[at - 1] ?? last
    next?.focus()
  }

  return <div ref={root} className={`pop-menu ${className}`.trim()} onKeyDown={key}>
    <button ref={trigger} type="button" className="pop-menu-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>{icon}</button>
    {/* 항목을 고르면(그 항목의 동작이 먼저 실행된 뒤) 닫고 초점을 버튼으로 돌린다. 시트를 여는 항목이면 시트가 그 버튼을 '연 요소'로 기억한다. */}
    {open && <div role="menu" aria-label={label} className="pop-menu-list" onClick={e => { if (e.target instanceof Element && e.target.closest('[role="menuitem"]')) close() }}>{children}</div>}
  </div>
}

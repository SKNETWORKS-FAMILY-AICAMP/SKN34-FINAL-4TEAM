import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import './pop-menu.css'

const ITEMS = '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])'
/** 창 가장자리에서 띄우는 여백(px) */
const EDGE = 8

/**
 * 열린 목록이 창 밖으로 잘리면 버튼 반대편으로 뒤집고(버튼과의 간격은 그대로), 반대편에도 자리가 없으면 창 안에 들 만큼만 옮긴다.
 * 어디에 열지는 쓰는 화면의 CSS가 정하므로 여기서는 세로 이동(transform)만 더한다: 화면에 고정해 띄운 회차 메뉴가 낮은 창에서 아래로 잘리던 문제.
 * ponytail: 가로로 잘리는 경우와 열린 뒤 창 크기가 바뀌는 경우는 다루지 않는다. 필요하면 가로 이동과 resize 재계산을 더한다.
 */
function keepInView(menu: HTMLElement | null, button: HTMLElement | null) {
  if (!menu || !button) return
  menu.style.transform = ''
  const m = menu.getBoundingClientRect()
  const b = button.getBoundingClientRect()
  if (!m.height) return
  let shift = 0
  if (m.top >= b.bottom && m.bottom > innerHeight - EDGE) {
    const flipped = b.top - (m.top - b.bottom) - m.height
    shift = flipped >= EDGE ? flipped - m.top : Math.max(innerHeight - EDGE - m.bottom, EDGE - m.top)
  } else if (m.bottom <= b.top && m.top < EDGE) {
    const flipped = b.bottom + (b.top - m.bottom)
    shift = flipped + m.height <= innerHeight - EDGE ? flipped - m.top : Math.min(EDGE - m.top, innerHeight - EDGE - m.bottom)
  }
  if (shift) menu.style.transform = `translateY(${Math.round(shift)}px)`
}

/**
 * 아이콘 버튼 하나가 여는 작은 메뉴(popover)다. 바깥 클릭·Escape·Tab·항목 선택으로 닫히고, 닫히면 초점이 버튼으로 돌아온다.
 * 항목은 쓰는 쪽이 role="menuitem"으로 그린다(↑↓·Home·End로 옮긴다). 버튼 모양과 열리는 방향은 className으로 정한다.
 * 잠긴 항목(disabled)은 초점을 받지 못하므로, 그 항목이 aria-describedby로 가리키는 사유는 메뉴의 설명으로도 이어 메뉴에 들어설 때 읽히게 한다.
 * 항목이 아닌 안내 문단(id가 있는 `.pop-menu-note`: 고를 항목이 없는 이유, 불러오는 중)도 같은 방식으로 메뉴의 설명이 된다.
 * 고를 수 있는 항목이 하나도 없으면 초점을 메뉴 자체에 둔다(버튼에 남기면 열린 메뉴의 이름과 사유가 읽히지 않는다). 항목이 늦게 도착하면 그때 첫 항목으로 옮긴다.
 * 목록이 창 밖으로 잘리면 버튼 반대편으로 뒤집는다(keepInView).
 */
export function PopMenu({ label, icon, className = '', children }: { label: string; icon: ReactNode; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const items = () => [...(root.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])]
  const close = () => { setOpen(false); trigger.current?.focus() }

  // 그리기 전에 자리를 잡아, 잘린 채로 한 번 보였다가 옮겨지지 않게 한다.
  useLayoutEffect(() => { if (open) keepInView(list.current, trigger.current) }, [open])

  useEffect(() => {
    if (!open) return
    const menu = list.current
    const locked = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"][aria-describedby]') ?? [])].filter(el => !el.matches(ITEMS))
    const notes = [...(menu?.querySelectorAll<HTMLElement>('.pop-menu-note[id]') ?? [])].map(el => el.id)
    const reasons = [...new Set([...notes, ...locked.flatMap(el => (el.getAttribute('aria-describedby') ?? '').split(/\s+/))])].filter(id => id && document.getElementById(id))
    if (reasons.length) menu?.setAttribute('aria-describedby', reasons.join(' '))
    const first = items()[0]
    ;(first ?? menu)?.focus()
    // 목록을 불러오는 중에 연 메뉴: 고를 수 있는 항목이 늦게 도착(또는 잠금이 풀림)하면 초점을 첫 항목으로 옮긴다. 그 사이 사용자가 초점을 다른 곳으로 옮겼으면 건드리지 않는다.
    const late = first || !menu ? undefined : new MutationObserver(() => {
      const arrived = items()[0]
      if (!arrived) return
      late?.disconnect()
      keepInView(menu, trigger.current) // 항목이 채워져 목록이 길어졌다
      if (document.activeElement === menu) arrived.focus()
    })
    if (menu) late?.observe(menu, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'] })
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    // 목록이 fixed라 버튼에 묶이지 않았다면(스크롤하는 회차 목록 안의 메뉴) 스크롤 뒤 다른 항목 옆에 남아 대상이 헷갈리므로 닫는다.
    const scrolled = () => { const list = root.current?.querySelector('[role="menu"]'); if (list && getComputedStyle(list).position === 'fixed') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('scroll', scrolled, true)
    return () => { late?.disconnect(); document.removeEventListener('pointerdown', away); document.removeEventListener('scroll', scrolled, true) }
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
    {open && <div ref={list} role="menu" aria-label={label} tabIndex={-1} className="pop-menu-list" onClick={e => { if (e.target instanceof Element && e.target.closest('[role="menuitem"]')) close() }}>{children}</div>}
  </div>
}

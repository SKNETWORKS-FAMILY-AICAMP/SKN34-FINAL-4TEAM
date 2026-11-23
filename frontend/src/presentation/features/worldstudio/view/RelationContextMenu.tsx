import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { clampMenu } from '../viewmodel/canvasLayout'

type MenuAction = { label: string; onSelect: () => void; disabled?: boolean; reason?: string }
/** 메뉴 한 줄: 바로 동작하는 항목, 또는 누르면 펼쳐지는 하위 목록(`여기에 설정 추가 ▸ 8유형`). */
export type MenuEntry = MenuAction | { label: string; items: MenuAction[] }

/**
 * 관계도 캔버스의 오른쪽 클릭 메뉴(빈 곳·카드·선). `role="menu"`/`menuitem`이고 body 포털에 `position: fixed`로 눌린 자리에 뜬다(캔버스의 overflow에 잘리지 않는다).
 * 열리면 첫 항목으로 초점이 가고 방향키·Home·End로 오가며 오른쪽·왼쪽 키로 하위 목록을 펼치고 접는다. Esc·메뉴 밖 누르기·창 크기 변경·스크롤·Tab은 닫는다.
 * 항목을 고르면 초점을 메뉴를 연 자리로 먼저 돌려준 뒤 닫고 동작한다: 동작이 시트를 열면 시트가 '연 요소'로 기억하는 것이 사라질 메뉴 항목이 아니라 처음 자리여서 시트를 닫은 뒤 초점이 제자리로 간다.
 * 잠긴 항목은 `aria-disabled`로 초점은 받되 동작하지 않고, 이유(`reason`)가 그 항목의 설명으로 읽힌다.
 */
export function RelationContextMenu({ label, x, y, entries, onClose }: { label: string; x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const opener = useRef(document.activeElement)
  const close = useRef(onClose)
  close.current = onClose
  const [open, setOpen] = useState('')
  const [pos, setPos] = useState({ x, y })
  const focusSub = useRef(false)
  const reasons = useId()
  const items = () => [...(box.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
  const restore = () => { const back = opener.current; if (back instanceof HTMLElement && back !== document.body && back.isConnected) back.focus() }

  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect()
    if (rect?.width) setPos(clampMenu({ x, y }, { w: rect.width, h: rect.height }, { w: window.innerWidth, h: window.innerHeight }))
  }, [x, y, open])
  useEffect(() => { items()[0]?.focus() }, [])
  const focusFirstSub = () => box.current?.querySelector<HTMLElement>('.relationship-submenu [role=menuitem]')?.focus()
  useEffect(() => {
    if (!open || !focusSub.current) return
    focusSub.current = false
    focusFirstSub()
  }, [open])
  useEffect(() => {
    const outside = (e: Event) => { if (!box.current?.contains(e.target as Node)) close.current() }
    const away = () => close.current()
    const scrolled = (e: Event) => { if (!(e.target instanceof Node && box.current?.contains(e.target))) close.current() } // 키가 큰 메뉴를 안에서 미는 스크롤은 닫지 않는다
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', scrolled, true)
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', away); window.removeEventListener('scroll', scrolled, true) }
  }, [])

  const run = (action: MenuAction) => {
    if (action.disabled) return
    restore()
    close.current()
    action.onSelect()
  }
  const move = (to: number) => { const list = items(); list[(to + list.length) % list.length]?.focus() }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items(), at = list.indexOf(document.activeElement as HTMLElement), current = e.target instanceof HTMLElement ? e.target : null
    if (e.key === 'ArrowDown') { e.preventDefault(); move(at + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(at - 1) }
    else if (e.key === 'Home') { e.preventDefault(); move(0) }
    else if (e.key === 'End') { e.preventDefault(); move(-1) }
    else if (e.key === 'ArrowRight' && current?.getAttribute('aria-haspopup')) {
      e.preventDefault()
      if (open === current.textContent) focusFirstSub() // 이미 펼쳐 있으면 펼침 효과가 다시 돌지 않으니 바로 옮긴다
      else { focusSub.current = true; setOpen(current.textContent ?? '') }
    }
    else if (e.key === 'ArrowLeft' && open) { e.preventDefault(); setOpen(''); box.current?.querySelector<HTMLElement>('[aria-haspopup][aria-expanded=true]')?.focus() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); restore(); close.current() }
    else if (e.key === 'Tab') close.current()
  }

  return createPortal(
    <div ref={box} className="relationship-menu" role="menu" aria-label={label} style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown}>
      {entries.map((entry, index) => 'items' in entry ? (
        <div key={entry.label} role="none">
          <button type="button" role="menuitem" className="relationship-menu-parent" aria-haspopup="menu" aria-expanded={open === entry.label} onClick={() => setOpen(open === entry.label ? '' : entry.label)}>{entry.label}</button>
          {open === entry.label && (
            <div role="menu" aria-label={entry.label} className="relationship-submenu">
              {entry.items.map((item) => <button key={item.label} type="button" role="menuitem" aria-disabled={item.disabled || undefined} onClick={() => run(item)}>{item.label}</button>)}
            </div>
          )}
        </div>
      ) : (
        <div key={entry.label} role="none">
          <button type="button" role="menuitem" aria-disabled={entry.disabled || undefined} aria-describedby={entry.reason ? `${reasons}-${index}` : undefined} onClick={() => run(entry)}>{entry.label}</button>
          {entry.reason && <p id={`${reasons}-${index}`} className="small muted">{entry.reason}</p>}
        </div>
      ))}
    </div>,
    document.body,
  )
}

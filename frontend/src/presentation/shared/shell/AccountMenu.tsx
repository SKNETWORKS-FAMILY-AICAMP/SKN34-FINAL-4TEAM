import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'

import { useAppSelector } from '../../../app/store'
import { useLogout } from '../session/useLogout'

/**
 * 목업 acctMenu(): 아바타 아래에 뜨는 계정 메뉴. 바깥을 누르거나 Esc를 누르면 닫히고,
 * ↑↓·Home·End로 항목을 옮기며 Tab으로 벗어나면 닫힙니다.
 */
export function AccountMenu({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const { role, user } = useAppSelector((s) => s.session)
  const logout = useLogout()
  const navigate = useNavigate()
  const menu = useRef<HTMLDivElement>(null)

  // 버튼 아래에 맞추고, 열려 있는 동안 창 크기·스크롤이 바뀌면 다시 맞춥니다. 리렌더 없이 위치만 고쳐 포커스를 지킵니다.
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect()
      if (!menu.current) return
      menu.current.style.top = `${r.bottom + scrollY + 8}px`
      menu.current.style.left = `${Math.max(12, r.right - 240)}px`
    }
    place()
    addEventListener('resize', place)
    addEventListener('scroll', place, { passive: true })
    return () => { removeEventListener('resize', place); removeEventListener('scroll', place) }
  }, [anchor])

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const outside = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); anchor.focus() } }
    document.addEventListener('click', outside)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('click', outside); document.removeEventListener('keydown', esc) }
  }, [anchor, onClose])

  const onKeyDown = (e: ReactKeyboardEvent) => {
    // 메뉴는 문서 끝에 그려지므로 Tab은 연 버튼으로 돌린 뒤 기본 이동에 맡겨 버튼 다음 요소로 이어지게 합니다.
    if (e.key === 'Tab') { onClose(); anchor.focus(); return }
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
    const at = items.findIndex((item) => item === document.activeElement)
    const moves: Partial<Record<string, number>> = { ArrowDown: (at + 1) % items.length, ArrowUp: at <= 0 ? items.length - 1 : at - 1, Home: 0, End: items.length - 1 }
    const to = moves[e.key]
    if (to === undefined) return
    e.preventDefault()
    items[to]?.focus()
  }
  const go = (to: string) => () => { onClose(); navigate(to) }
  const Item = ({ to, id, className, children }: { to: string; id?: string; className?: string; children: ReactNode }) => (
    <button type="button" role="menuitem" id={id} className={className} onClick={go(to)}>{children}</button>
  )

  return createPortal(
    <div ref={menu} className="pop acctm" role="menu" onKeyDown={onKeyDown}>
      {role ? (
        <>
          <Item to="/me/profile" className="who">
            <span className="meav">{user.nick.slice(0, 1)}</span><span><b>{user.nick}</b><small>{user.email}</small></span><em>프로필 ›</em>
          </Item>
          <Item to="/lib">내 서재</Item><Item to="/me/liked">관심 소설</Item><Item to="/me/pay">결제 내역</Item><hr />
          <Item to="/me/inquiry">문의하기</Item><Item to="/reports">내 신고</Item><Item to="/me/notice">공지사항</Item><Item to="/me/event">이벤트</Item><hr />
          <button type="button" role="menuitem" onClick={() => { void logout().then((ok) => { if (ok) onClose() }) }}>로그아웃</button>
        </>
      ) : (
        <>
          <div className="who"><span className="meav g">?</span><span><b>로그인해 주세요</b><small>읽기·쓰기를 한 계정으로</small></span></div>
          <Item to="/login" id="menuLogin" className="pri">로그인</Item><Item to="/me/signup">회원가입</Item><hr />
          <Item to="/me/notice">공지사항</Item><Item to="/me/event">이벤트</Item><Item to="/me/inquiry">문의하기</Item>
        </>
      )}
    </div>,
    document.body,
  )
}

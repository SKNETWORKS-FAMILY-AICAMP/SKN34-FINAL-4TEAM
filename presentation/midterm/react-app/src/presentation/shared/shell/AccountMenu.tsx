import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'

import { useAppDispatch, useAppSelector } from '../../../app/store'
import { toast } from '../events'
import { sessionActions } from '../session/sessionSlice'

/** 목업 acctMenu(): 아바타 아래에 뜨는 계정 메뉴. 바깥을 누르거나 Esc를 누르면 닫힙니다. */
export function AccountMenu({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const { role, user } = useAppSelector((s) => s.session)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const menu = useRef<HTMLDivElement>(null)
  const r = anchor.getBoundingClientRect()

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const outside = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); anchor.focus() } }
    document.addEventListener('click', outside)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('click', outside); document.removeEventListener('keydown', esc) }
  }, [anchor, onClose])

  const go = (to: string) => () => { onClose(); navigate(to) }
  const Item = ({ to, id, className, children }: { to: string; id?: string; className?: string; children: ReactNode }) => (
    <button type="button" role="menuitem" id={id} className={className} onClick={go(to)}>{children}</button>
  )

  return createPortal(
    <div ref={menu} className="pop acctm" role="menu" style={{ top: r.bottom + scrollY + 8, left: Math.max(12, r.right - 240) }}>
      {role ? (
        <>
          <Item to="/me/profile" className="who">
            <span className="meav">{user.nick.slice(0, 1)}</span><span><b>{user.nick}</b><small>{user.email}</small></span><em>프로필 ›</em>
          </Item>
          <Item to="/lib">내 서재</Item><Item to="/me/liked">관심 소설</Item><Item to="/me/pay">결제 내역</Item><hr />
          <Item to="/me/inquiry">문의하기</Item><Item to="/me/notice">공지사항</Item><Item to="/me/event">이벤트</Item><hr />
          <button type="button" role="menuitem" onClick={() => { onClose(); dispatch(sessionActions.logout()); navigate('/'); toast('로그아웃했어요') }}>로그아웃</button>
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

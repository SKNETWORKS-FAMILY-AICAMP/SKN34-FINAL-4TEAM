import { useId, useState, type ReactNode } from 'react'

import { Go } from '../Go'
import { BackChev, FoldIcon } from '../icons'
import { AccountMenu } from './AccountMenu'
import { ThemeButton } from './ThemeButton'
import { useGnbViewModel } from './useGnbViewModel'

/**
 * 관리 화면(작품 관리·세계관 관리)의 왼쪽 사이드바. 공용 상단바(Gnb)를 그리지 않는 화면에서 이 사이드바가 상단바 역할을 맡는다.
 * 위에서 아래로 맨 위 줄(STORYFORK 로고 + 접기 토글) / 본문(돌아가기 링크 · 화면의 메뉴(children) · 도구 묶음(tools)) / 맨 아래 줄(알림·테마·계정)이다.
 * 접힌 동안(open=false)에는 본문이 hidden이고 돌아가기 링크와 도구는 그리지 않는다: 호출 측이 둘을 상단 줄(.ep-top)로 옮겨 그리므로 두 곳에 동시에 두지 않는다.
 * 위치·접기·좁은 화면 배치는 shared/episode.css(.ep-menu-*) 한 곳이 정한다. 검색 버튼은 두지 않는다: Ctrl K(전역 QuickJump)가 남는다.
 */
export function ManageMenu({ name, open, onOpenChange, back, tools, children }: {
  /** 접기 토글의 이름에 쓰는 말: '작품'이면 '작품 메뉴 접기' */
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
  back: { to: string; label: string }
  /** 본문 맨 아래 도구 묶음 */
  tools: ReactNode
  /** 화면을 바꾸는 메뉴(nav) */
  children: ReactNode
}) {
  const bodyId = useId()
  const toggleLabel = `${name} 메뉴 ${open ? '접기' : '펼치기'}` // 아이콘만 있는 버튼: 이름(aria-label)과 마우스 툴팁(title)이 같은 글이다
  return (
    <div className="ep-menu">
      <div className="ep-menu-top">
        <Go to="/" className="logo ep-menu-logo" aria-label="STORYFORK 홈으로" title="홈으로"><b>SF</b>STORYFORK</Go>
        <button type="button" className="ep-menu-toggle" aria-expanded={open} aria-controls={bodyId} aria-label={toggleLabel} title={toggleLabel} onClick={() => onOpenChange(!open)}><FoldIcon /></button>
      </div>
      <div id={bodyId} className="ep-menu-body" hidden={!open}>
        {open && <Go to={back.to} className="ep-back ep-menu-back"><BackChev />{back.label}</Go>}
        {children}
        <div className="ep-menu-tools">{tools}</div>
      </div>
      <ManageMenuAccount />
    </div>
  )
}

/**
 * 사이드바 맨 아래 줄: 공용 상단바(Gnb)가 맡던 알림·테마·계정. 데이터는 상단바와 같은 `useGnbViewModel`(읽지 않은 알림 수·이름 첫 글자)이고 이름·aria·계정 메뉴(`AccountMenu`)도 같다.
 * 이 화면들은 로그인한 사용자만 연다(RequireRole)라 비로그인 모양(상단바 아바타의 게스트 아이콘)은 두지 않는다.
 */
function ManageMenuAccount() {
  const { initial, unread } = useGnbViewModel()
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null)
  return (
    <div className="ep-menu-account">
      <Go to="/notifications" className="btn sm" aria-label={`알림함${unread ? `, 읽지 않은 알림 ${unread}건` : ''}`}>
        알림{unread > 0 && <> <span className="nb">{unread}</span></>}
      </Go>
      <ThemeButton />
      <button type="button" className="avatar" aria-label="내 계정 메뉴" aria-haspopup="menu" aria-expanded={!!menuAnchor} onClick={(e) => setMenuAnchor(menuAnchor ? null : e.currentTarget)}><span>{initial}</span></button>
      {menuAnchor && <AccountMenu anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />}
    </div>
  )
}

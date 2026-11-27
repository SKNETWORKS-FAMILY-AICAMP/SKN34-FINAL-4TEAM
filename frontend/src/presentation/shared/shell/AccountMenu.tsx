import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'

import { useAppSelector } from '../../../app/store'
import type { CreditLedgerUseCase } from '../../../domain/usecases/CreditLedgerUseCase'
import { openQuick } from '../events'
import { useLogout } from '../session/useLogout'
import { useCreditBalance } from './useCreditBalance'
import { useTheme } from './useTheme'

/**
 * 프로필 아래 '보유 크레딧' 줄(누르면 결제 내역). 잔액 조회 상태는 이 줄이 따로 갖는다. 잔액이 늦게 도착해 AccountMenu가 다시 그려지면
 * 안쪽에서 만든 Item이 새로 마운트돼, 열어 둔 메뉴의 포커스를 잃기 때문이다.
 */
function CreditRow({ creditLedger, onSelect }: { creditLedger?: Pick<CreditLedgerUseCase, 'balance'>; onSelect: () => void }) {
  const credit = useCreditBalance(creditLedger)
  return (
    <button type="button" role="menuitem" className="acct-credit" onClick={onSelect}>
      {credit.status === 'failed'
        ? <span>크레딧을 불러오지 못했어요</span>
        : <><span>보유 크레딧</span>{' '}<b>{credit.status === 'ready' ? credit.total.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1, roundingMode: 'trunc' }) : '…'}</b></>}
    </button>
  )
}

/** 메뉴 항목 하나. AccountMenu 안에서 만들면 다시 그릴 때마다 새 컴포넌트가 돼 모든 항목이 다시 마운트되고 옮겨 둔 포커스를 잃는다. label은 보이는 글과 달리 읽혀야 할 때(알림함의 읽지 않은 수)만 준다. */
function Item({ onSelect, id, className, label, children }: { onSelect: () => void; id?: string; className?: string; label?: string; children: ReactNode }) {
  return <button type="button" role="menuitem" id={id} className={className} aria-label={label} onClick={onSelect}>{children}</button>
}

/**
 * 다크 모드 항목. 켜진 상태는 aria-checked가 알리고(오른쪽 켜짐·꺼짐은 눈으로 보는 표시라 aria-hidden), 눌러도 메뉴는 열린 채 테마만 바뀐다.
 * 테마 구독은 이 항목이 따로 가져, 테마가 바뀔 때 메뉴 전체를 다시 그리지 않는다.
 * 관리자 상단바의 닉네임 메뉴(PopMenu)도 이 항목을 그대로 쓴다: PopMenu는 role="menuitem"만 눌러서 닫으므로 여기서도 열린 채다.
 */
export function ThemeRow() {
  const { dark, toggle } = useTheme()
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={dark} className="acct-theme" onClick={toggle}>
      <span>다크 모드</span><em aria-hidden="true">{dark ? '켜짐' : '꺼짐'}</em>
    </button>
  )
}

/** 키보드가 오가는 항목. 601px 이상에서 CSS가 숨긴 항목(.acct-m)은 뺀다: 보이지 않는 항목에 초점이 가면 초점이 사라진다. 레이아웃을 재지 않고 display만 읽어 jsdom에서도 같다. */
const visibleItems = (menu: HTMLElement | null) => [...(menu?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])].filter((item) => getComputedStyle(item).display !== 'none')
/**
 * 목업 acctMenu(): 아바타 아래에 뜨는 계정 메뉴. 바깥을 누르거나 Esc를 누르면 닫히고,
 * ↑↓·Home·End로 항목을 옮기며 Tab으로 벗어나면 닫힙니다.
 * 로그인하면 프로필 아래에 보유 크레딧(메뉴가 열릴 때 조회)을, 운영자 계정에는 운영자 대시보드 바로가기를 더합니다.
 * 운영자 항목은 메뉴 표시일 뿐이고 /admin의 접근 검사는 기존 RequireRole·서버가 맡습니다.
 * 상단바가 다시 그려질 때마다(홈은 히어로 자동 넘김으로 4.5초마다) onClose가 새 함수로 오므로, 첫 항목 포커스는 열릴 때 한 번만 주고 닫기는 최신 onClose를 ref로 부릅니다.
 * 다크 모드 항목(menuitemcheckbox)은 로그인·비로그인 메뉴 모두에 있고 상단바·사이드바 어디서 열어도 같습니다.
 * shortcuts는 상단바(Gnb)에서 연 메뉴만 넘깁니다: 상단바의 검색·알림 버튼을 600px 이하에서 숨기므로 그 자리를 이 메뉴의 검색·알림함 항목(.acct-m)이 이어받고,
 * 601px부터는 CSS가 숨깁니다. 사이드바(ManageMenu)는 알림 버튼을 그대로 가져 넘기지 않습니다. 비로그인에는 알림함이 없습니다.
 * creditLedger는 테스트가 넣는 UseCase 대역입니다.
 */
export function AccountMenu({ anchor, onClose, creditLedger, shortcuts }: { anchor: HTMLElement; onClose: () => void; creditLedger?: Pick<CreditLedgerUseCase, 'balance'>; shortcuts?: { unread: number } }) {
  const { role, user } = useAppSelector((s) => s.session)
  const logout = useLogout()
  const navigate = useNavigate()
  const menu = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })

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
    visibleItems(menu.current)[0]?.focus()
    const outside = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) close.current() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { close.current(); anchor.focus() } }
    document.addEventListener('click', outside)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('click', outside); document.removeEventListener('keydown', esc) }
  }, [anchor])

  const onKeyDown = (e: ReactKeyboardEvent) => {
    // 메뉴는 문서 끝에 그려지므로 Tab은 연 버튼으로 돌린 뒤 기본 이동에 맡겨 버튼 다음 요소로 이어지게 합니다.
    if (e.key === 'Tab') { onClose(); anchor.focus(); return }
    const items = visibleItems(menu.current)
    const at = items.findIndex((item) => item === document.activeElement)
    const moves: Partial<Record<string, number>> = { ArrowDown: (at + 1) % items.length, ArrowUp: at <= 0 ? items.length - 1 : at - 1, Home: 0, End: items.length - 1 }
    const to = moves[e.key]
    if (to === undefined) return
    e.preventDefault()
    items[to]?.focus()
  }
  const go = (to: string) => () => { onClose(); navigate(to) }
  // 검색 시트는 닫힐 때 열릴 때의 초점 항목으로 돌아가므로, 곧 사라질 이 항목 대신 연 버튼에 초점을 돌려 놓고 연다.
  const mobile = shortcuts && (
    <>
      <Item className="acct-m" onSelect={() => { anchor.focus(); onClose(); openQuick() }}>검색</Item>
      {role && <Item className="acct-m" onSelect={go('/notifications')} label={shortcuts.unread ? `알림함, 읽지 않은 알림 ${shortcuts.unread}건` : undefined}>알림함{shortcuts.unread > 0 && <> <span className="nb">{shortcuts.unread}</span></>}</Item>}
      <hr className="acct-m" />
    </>
  )

  return createPortal(
    <div ref={menu} className="pop acctm" role="menu" aria-label={role ? '내 계정 메뉴' : '로그인·회원가입 메뉴'} onKeyDown={onKeyDown}>
      {role ? (
        <>
          <Item onSelect={go('/me/profile')} className="who">
            <span className="meav" aria-hidden="true">{user.nick.slice(0, 1)}</span><span className="who-text"><b title={user.nick}>{user.nick}</b><small title={user.email}>{user.email}</small></span><em>프로필 ›</em>
          </Item>
          <CreditRow creditLedger={creditLedger} onSelect={go('/me/pay')} /><hr />
          {mobile}
          {role === 'admin' && <Item onSelect={go('/admin')}>운영자 대시보드</Item>}
          <Item onSelect={go('/lib')}>내 서재</Item><Item onSelect={go('/content?view=reports')}>내 제보·수정 제안</Item><Item onSelect={go('/me/pay')}>결제 내역</Item><hr />
          <Item onSelect={go('/me/inquiry')}>문의하기</Item><Item onSelect={go('/reports')}>내 신고</Item><Item onSelect={go('/me/notice')}>공지사항</Item><Item onSelect={go('/me/event')}>이벤트</Item><ThemeRow /><hr />
          <button type="button" role="menuitem" onClick={() => { void logout().then((ok) => { if (ok) onClose() }) }}>로그아웃</button>
        </>
      ) : (
        <>
          <div className="who"><span className="meav g">?</span><span className="who-text"><b>로그인해 주세요</b><small>읽기·쓰기를 한 계정으로</small></span></div>
          <Item onSelect={go('/login')} id="menuLogin" className="pri">로그인</Item><Item onSelect={go('/me/signup')}>회원가입</Item><hr />
          {mobile}
          <Item onSelect={go('/me/notice')}>공지사항</Item><Item onSelect={go('/me/event')}>이벤트</Item><Item onSelect={go('/me/inquiry')}>문의하기</Item><ThemeRow />
        </>
      )}
    </div>,
    document.body,
  )
}

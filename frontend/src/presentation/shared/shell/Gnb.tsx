import { useState } from 'react'

import { openPolicy, openQuick } from '../events'
import { Go } from '../Go'
import { AccountMenu } from './AccountMenu'
import { useGnbViewModel } from './useGnbViewModel'

/** 목업 gnb(on) */
export function Gnb({ on = '' }: { on?: string }) {
  const { role, initial, unread, pending } = useGnbViewModel()
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null)
  return (
    <>
    <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }}>본문으로 바로가기</a>
    <header className="gnb">
      <div className="wrap in">
        <Go to="/" className="logo" aria-label="STORYFORK 홈으로" title="홈으로"><b>SF</b>STORYFORK</Go>
        <nav className="nav" aria-label="주요 메뉴">
          {([['worldstudio', '세계관', '세계관'], ['rank', '랭킹', '랭킹'], ['chat', '캐릭터 챗', '챗'], ['lib', '내 서재', '서재']] as const).map(([k, l, sh]) => (
            <Go key={k} to={'/' + k} className={on === k ? 'on' : ''} aria-current={on === k ? 'page' : undefined}
              aria-label={k === 'lib' && pending ? `내 서재, 처리할 독자 제보 ${pending}건` : undefined}>
              <span className="lf">{l}</span><span className="ls">{sh}</span>
              {k === 'lib' && pending > 0 && <span className="nb" title={`처리할 독자 제보 ${pending}건`}>{pending}</span>}
            </Go>
          ))}
        </nav>
        <button type="button" className="search" aria-label="소설·인물·회차 검색" onClick={openQuick}>🔍 소설·인물·회차 검색<kbd>Ctrl K</kbd></button>
        <Go to="/notifications" className="btn sm" aria-label={`알림함${unread ? `, 읽지 않은 알림 ${unread}건` : ''}`}>
          알림{unread > 0 && <> <span className="nb">{unread}</span></>}
        </Go>
        <button type="button" className="credit" onClick={openPolicy} title="크레딧 정책은 아직 확정되지 않았어요">
          ✦ 크레딧
        </button>
        <button type="button" className={`avatar ${role ? '' : 'guest'}`} aria-label={role ? '내 계정 메뉴' : '로그인·회원가입 메뉴'} aria-haspopup="menu"
          aria-expanded={!!menuAnchor} onClick={(e) => setMenuAnchor(menuAnchor ? null : e.currentTarget)}>
          <span>{role ? initial : <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="currentColor" /><path d="M4 21c.8-4.4 4-7 8-7s7.2 2.6 8 7z" fill="currentColor" /></svg>}</span>
        </button>
      </div>
      {menuAnchor && <AccountMenu anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />}
    </header>
    </>
  )
}

/** 목업 foot(). 오프라인 데모 안내는 서버 없는 시연(`--mode mockup`)에서만 붙인다. */
export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <b>STORYFORK</b><span>SKN34 최종 프로젝트 4팀{import.meta.env.MODE === 'mockup' && ' · 인터랙티브 MVP (오프라인 · AI 응답은 미리 정한 데모)'}</span>
      </div>
    </footer>
  )
}

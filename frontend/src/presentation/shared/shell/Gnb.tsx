import { useAppSelector } from '../../../app/store'
import { Go } from '../Go'
import { useGnbViewModel } from './useGnbViewModel'

/** 목업 gnb(on) */
export function Gnb({ on = '' }: { on?: string }) {
  const { role, initial, unread, pending } = useGnbViewModel()
  return (
    <header className="gnb">
      <div className="wrap in">
        <Go to="/" className="logo" aria-label="STORYFORK 홈으로" title="홈으로"><b>SF</b>STORYFORK</Go>
        <nav className="nav" aria-label="주요 메뉴">
          {([['rank', '랭킹', '랭킹'], ['chat', '캐릭터 챗', '챗'], ['lib', '내 서재', '서재']] as const).map(([k, l, sh]) => (
            <Go key={k} to={'/' + k} className={on === k ? 'on' : ''} aria-current={on === k ? 'page' : undefined}
              aria-label={k === 'lib' && pending ? `내 서재, 처리할 독자 제보 ${pending}건` : undefined}>
              <span className="lf">{l}</span><span className="ls">{sh}</span>
              {k === 'lib' && pending > 0 && <span className="nb" title={`처리할 독자 제보 ${pending}건`}>{pending}</span>}
            </Go>
          ))}
        </nav>
        <button type="button" className="search" aria-label="소설·인물·회차 검색">🔍 소설·인물·회차 검색<kbd>Ctrl K</kbd></button>
        <Go to="/notifications" className="btn sm" aria-label={`알림함${unread ? `, 읽지 않은 알림 ${unread}건` : ''}`}>
          알림{unread > 0 && <> <span className="nb">{unread}</span></>}
        </Go>
        <button type="button" className="credit" title="크레딧 정책은 아직 확정되지 않았어요">
          ✦ 크레딧 <span className="demo" style={{ borderColor: 'currentColor', color: 'inherit' }}>데모</span>
        </button>
        <button type="button" className={`avatar ${role ? '' : 'guest'}`} aria-label={role ? '내 계정 메뉴' : '로그인·회원가입 메뉴'} aria-haspopup="menu">
          <span>{role ? initial : <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="currentColor" /><path d="M4 21c.8-4.4 4-7 8-7s7.2 2.6 8 7z" fill="currentColor" /></svg>}</span>
        </button>
      </div>
    </header>
  )
}

/** 목업 foot() */
export function Footer() {
  const role = useAppSelector((s) => s.session.role)
  return (
    <footer className="foot">
      <div className="wrap">
        <b>STORYFORK</b><span>SKN34 최종 프로젝트 4팀 · 인터랙티브 MVP (오프라인 · AI 응답은 미리 정한 데모)</span>
        <div className="r">
          {/* 목업과 같이 메모리 상태를 버리려고 홈으로 새로고침합니다. */}
          <button type="button" onClick={() => location.assign('/')}>데모 초기화</button>
          {!role && <Go to="/login">로그인</Go>}
        </div>
      </div>
    </footer>
  )
}

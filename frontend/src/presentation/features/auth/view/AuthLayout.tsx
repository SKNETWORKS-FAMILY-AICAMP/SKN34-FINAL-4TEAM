import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Art } from '../../../shared/art'
import { BackChev } from '../../../shared/icons'
import { Footer } from '../../../shared/shell/Gnb'
import { ThemeButton } from '../../../shared/shell/ThemeButton'

/** 인증 화면 공통 틀. 공용 푸터는 .lg와 형제로 둬 #root 직속이어야 `#root:has(>.foot)` 하단 고정 규칙이 먹는다. */
export function AuthLayout({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return <>
  <div className="lg">
    <aside className="lg-l" aria-label="STORYFORK">
      <Link to="/" className="logo"><b>SF</b>STORYFORK</Link>
      <div className="auth-brand-copy">
        <p className="auth-brand-title">원작을<br />나만의 소설로.</p>
        <p>읽다가 마음에 드는 회차에서 포크해<br />인물과 함께 다음 회차를 써 보세요.</p>
      </div>
      <div className="lg-art" aria-hidden="true"><Art theme="star" w={420} h={300} seed="loginart" /></div>
    </aside>
    <main id="main" tabIndex={-1} className="lg-r" aria-labelledby="auth-title">
      <div className="lg-card">
        <header className="auth-header"><Link to="/" className="back"><BackChev />홈으로</Link><ThemeButton /></header>
        <h1 id="auth-title">{title}</h1>
        {intro && <p className="auth-intro">{intro}</p>}
        {children}
        <details className="auth-dev">
          <summary>개발용 서비스 안내</summary>
          <p>인증·계정은 실제 서버로 처리하며 작품·서재는 시연 데이터예요. 로컬 메일은 Mailpit에서 확인할 수 있어요. 운영 약관과 동의 절차는 준비 중이에요.</p>
        </details>
      </div>
    </main>
  </div>
  <Footer />
  </>
}

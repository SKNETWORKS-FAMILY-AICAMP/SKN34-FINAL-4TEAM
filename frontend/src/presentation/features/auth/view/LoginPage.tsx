import { Link } from 'react-router'
import { useLoginViewModel } from '../viewmodel/useLoginViewModel'
import { AuthLayout } from './AuthLayout'

/** L01 로그인: Core에서 확인한 사용자와 권한만 세션에 반영합니다. */
export function LoginPage() {
  const vm = useLoginViewModel()
  return <AuthLayout title="로그인" intro="이메일 확인을 마친 계정으로 로그인해 주세요.">
    {vm.loginMsg && <div className="policy">{vm.loginMsg}</div>}
    {vm.error && <p role="alert">{vm.error}</p>}
    <form id="lgf" className="auth-form" aria-busy={vm.pending} onSubmit={(e) => {
      e.preventDefault()
      const data = new FormData(e.currentTarget)
      void vm.submit(String(data.get('email') ?? '').trim(), String(data.get('password') ?? ''))
      const password = e.currentTarget.elements.namedItem('password')
      if (password instanceof HTMLInputElement) password.value = ''
    }}>
      <label className="field">이메일<input className="inp" name="email" type="email" autoComplete="username" required maxLength={254} disabled={vm.pending} /></label>
      <label className="field">비밀번호<input className="inp" name="password" type="password" autoComplete="current-password" required disabled={vm.pending} /></label>
      <button className="btn pri" type="submit" disabled={vm.pending}>{vm.pending ? '로그인 중…' : '로그인'}</button>
    </form>
    <nav className="lg-links" aria-label="로그인 도움"><Link to="/me/signup">회원가입</Link><Link to="/auth/forgot-password">비밀번호 찾기</Link><Link to="/me/inquiry">로그인 문의</Link></nav>
    <p className="auth-help">이메일 인증을 아직 마치지 않았나요?</p>
    <div className="lg-links"><Link to="/auth/resend-verification">이메일 인증·확인 메일 재발송</Link></div>
  </AuthLayout>
}

import { Link } from 'react-router'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useLoginViewModel } from '../viewmodel/useLoginViewModel'
import { AuthLayout } from './AuthLayout'
import { useFocusOnAppear } from './useFocusOnAppear'

/** L01 로그인: Core에서 확인한 사용자와 권한만 세션에 반영합니다. */
export function LoginPage() {
  const vm = useLoginViewModel()
  useDocumentTitle('로그인')
  const alertRef = useFocusOnAppear<HTMLParagraphElement>(vm.error)
  const invalid = { 'aria-invalid': vm.invalid, 'aria-describedby': vm.invalid ? 'login-error' : undefined }
  return <AuthLayout title="로그인" intro="이메일 확인을 마친 계정으로 로그인해 주세요.">
    {vm.loginMsg && <div className="policy" role="status">{vm.loginMsg}</div>}
    {vm.error && <p ref={alertRef} id="login-error" role="alert" tabIndex={-1}>{vm.error}</p>}
    <form id="lgf" className="auth-form" noValidate aria-busy={vm.pending} onSubmit={(e) => {
      e.preventDefault()
      const data = new FormData(e.currentTarget)
      const password = e.currentTarget.elements.namedItem('password')
      // 요청을 보냈을 때만 비밀번호를 지운다. 입력 오류로 보내지 않았으면 고쳐서 바로 다시 보낼 수 있게 둔다.
      if (vm.submit(String(data.get('email') ?? '').trim(), String(data.get('password') ?? '')) && password instanceof HTMLInputElement) password.value = ''
    }}>
      <label className="field">이메일<input className="inp" name="email" type="email" autoComplete="username" required maxLength={254} readOnly={vm.pending} {...invalid} /></label>
      <label className="field">비밀번호<input className="inp" name="password" type="password" autoComplete="current-password" required readOnly={vm.pending} {...invalid} /></label>
      <button className="btn pri" type="submit" disabled={vm.pending}>{vm.pending ? '로그인 중…' : '로그인'}</button>
    </form>
    <nav className="lg-links" aria-label="로그인 도움"><Link to="/me/signup">회원가입</Link><Link to="/auth/forgot-password">비밀번호 찾기</Link><Link to="/me/inquiry">로그인 문의</Link></nav>
    <p className="auth-help">이메일 인증을 아직 마치지 않았나요?</p>
    <div className="lg-links"><Link to="/auth/resend-verification">이메일 인증·확인 메일 재발송</Link></div>
  </AuthLayout>
}

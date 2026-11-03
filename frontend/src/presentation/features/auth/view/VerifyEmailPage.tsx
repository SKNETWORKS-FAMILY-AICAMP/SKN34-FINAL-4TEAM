import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { useVerifyEmailViewModel } from '../viewmodel/useSignupViewModel'
import { AuthLayout } from './AuthLayout'

export function VerifyEmailChangePage() {
  const vm = useVerifyEmailViewModel(true)
  return <AuthLayout title="이메일 변경 확인">
    <p role="status">{vm.message}</p>
    {vm.state === 'error' && <p className="auth-help">새 확인 메일은 프로필에서 이메일 변경을 다시 요청해 주세요. 새 주소를 확인하기 전에는 기존 이메일을 사용할 수 있어요.</p>}
    {vm.state !== 'pending' && <div className="auth-actions">
      <Link to="/me/profile" className={vm.state === 'error' || vm.signedIn ? 'btn pri' : 'btn'}>{vm.state === 'error' ? '프로필에서 새 확인 메일 요청' : '프로필로'}</Link>
      <Link to="/login" className={vm.state === 'success' && !vm.signedIn ? 'btn pri' : 'btn'}>로그인</Link>
    </div>}
  </AuthLayout>
}

export function VerifyEmailPage() {
  const vm = useVerifyEmailViewModel()
  const password = useRef<HTMLInputElement>(null)
  const error = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (vm.passwordError) password.current?.focus()
    else if (vm.state === 'error') error.current?.focus()
  }, [vm.passwordError, vm.state, vm.message])
  return <AuthLayout title="이메일 확인" intro={vm.state !== 'success' ? '가입할 때 정한 비밀번호를 입력해 주세요. 이메일 확인을 마친 뒤 로그인할 수 있어요.' : undefined}>
    {vm.message && <p ref={error} role={vm.state === 'error' ? 'alert' : 'status'} tabIndex={vm.state === 'error' ? -1 : undefined}>{vm.message}</p>}
    {vm.canVerify && <form className="auth-form" noValidate aria-busy={vm.state === 'pending'} onSubmit={(event) => { event.preventDefault(); void vm.submit() }}>
      <label className="field">가입 비밀번호<input ref={password} className="inp" name="password" type="password" autoComplete="current-password" required minLength={8} value={vm.password} disabled={vm.state === 'pending'} aria-invalid={!!vm.passwordError} aria-describedby={vm.passwordError ? 'verify-password-error' : 'verify-password-help'} onChange={(event) => vm.setPassword(event.target.value)} /></label>
      <p id="verify-password-help" className="small muted">본인이 가입 요청을 하지 않았거나 비밀번호를 정한 적이 없다면 다시 가입해 주세요.</p>
      {vm.passwordError && <p id="verify-password-error" role="alert">{vm.passwordError}</p>}
      <button className="btn pri" type="submit" disabled={vm.state === 'pending'}>{vm.state === 'pending' ? '확인 중…' : '이메일 확인'}</button>
    </form>}
    {vm.state !== 'pending' && <div className="auth-actions">
      {vm.state === 'error' && <><Link to="/me/signup" className="btn pri">다시 가입</Link><Link to="/auth/resend-verification" className="btn">확인 메일 재발송</Link></>}
      <Link to="/login" className={vm.state === 'success' ? 'btn pri' : 'btn'}>로그인</Link>
    </div>}
  </AuthLayout>
}

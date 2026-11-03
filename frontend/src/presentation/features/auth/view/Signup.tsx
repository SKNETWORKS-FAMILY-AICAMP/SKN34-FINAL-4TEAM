import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { useSignupViewModel } from '../viewmodel/useSignupViewModel'
import { AuthLayout } from './AuthLayout'

export function Signup() {
  const vm = useSignupViewModel()
  const form = useRef<HTMLFormElement>(null)
  const [f, setF] = useState({ email: '', nick: '', p1: '', p2: '' })
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF((current) => ({ ...current, [k]: e.target.value }))
  useEffect(() => { form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus() }, [vm.errors])
  return <AuthLayout title="회원가입" intro="가입 후 이메일 확인을 마치면 로그인할 수 있어요.">
    {vm.error && <p role="alert">{vm.error}</p>}
    {vm.message && <p role="status">{vm.message}</p>}
    {vm.submittedEmail ? <div className="auth-result">
      <p className="auth-email">{vm.submittedEmail}</p>
      <p>이 주소로 확인 메일이 도착하면 열어 주세요. 이메일 인증을 마친 뒤 로그인해 주세요.</p>
      <Link to="/login" className="btn pri">인증 후 로그인</Link>
      <Link to="/auth/resend-verification" className="btn" state={{ email: vm.submittedEmail }}>확인 메일 재발송</Link>
      <button className="btn" type="button" onClick={() => { vm.startOver(); setF({ email: '', nick: '', p1: '', p2: '' }) }}>다른 이메일로 가입</button>
    </div> : <>
      <form ref={form} className="auth-form" id="suf" noValidate aria-busy={vm.pending} onSubmit={(e) => {
        e.preventDefault()
        void vm.signup(f).then((ok) => { if (ok) setF((current) => ({ ...current, p1: '', p2: '' })) })
      }}>
        <p className="small muted">모든 항목은 필수예요.</p>
        <label className="field">이메일<input className="inp" name="email" type="email" autoComplete="email" required maxLength={254} value={f.email} disabled={vm.pending} aria-invalid={!!vm.errors.email} aria-describedby={vm.errors.email ? 'signup-email-error' : undefined} onChange={set('email')} /></label>
        {vm.errors.email && <p id="signup-email-error" role="alert">{vm.errors.email}</p>}
        <label className="field">닉네임<input className="inp" name="nickname" autoComplete="nickname" required minLength={2} maxLength={12} placeholder="2~12자" value={f.nick} disabled={vm.pending} aria-invalid={!!vm.errors.nick} aria-describedby={vm.errors.nick ? 'signup-nick-error' : undefined} onChange={set('nick')} /></label>
        {vm.errors.nick && <p id="signup-nick-error" role="alert">{vm.errors.nick}</p>}
        <label className="field">비밀번호<input className="inp" name="password" type="password" autoComplete="new-password" required minLength={8} value={f.p1} disabled={vm.pending} aria-invalid={!!vm.errors.p1} aria-describedby={vm.errors.p1 ? 'signup-password-help signup-password-error' : 'signup-password-help'} onChange={set('p1')} /></label>
        <p id="signup-password-help" className="small muted">8자 이상 입력해 주세요. 공백만으로는 만들 수 없어요.</p>
        <details className="password-help small muted"><summary>비밀번호 길이 안내</summary><p>최대 72바이트(UTF-8)까지 입력할 수 있어요. 한글·이모지는 영문보다 더 많은 공간을 사용해요.</p></details>
        {vm.errors.p1 && <p id="signup-password-error" role="alert">{vm.errors.p1}</p>}
        <label className="field">비밀번호 확인<input className="inp" name="confirmation" type="password" autoComplete="new-password" required value={f.p2} disabled={vm.pending} aria-invalid={!!vm.errors.p2} aria-describedby={vm.errors.p2 ? 'signup-confirmation-error' : undefined} onChange={set('p2')} /></label>
        {vm.errors.p2 && <p id="signup-confirmation-error" role="alert">{vm.errors.p2}</p>}
        <button className="btn pri" type="submit" disabled={vm.pending}>{vm.pending ? '요청 중…' : '가입 요청'}</button>
      </form>
      <div className="lg-links"><Link to="/login">로그인으로</Link><Link to="/auth/resend-verification" state={{ email: f.email }}>확인 메일 재발송</Link></div>
    </>}
  </AuthLayout>
}

export function ResendVerificationPage() {
  const vm = useSignupViewModel()
  const { state } = useLocation()
  const [email, setEmail] = useState<string>(typeof state?.email === 'string' ? state.email : '')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (vm.errors.email) input.current?.focus() }, [vm.errors])
  return <AuthLayout title="확인 메일 재발송" intro="가입할 때 입력한 이메일로 확인 메일을 다시 요청해 주세요.">
    {vm.error && <p role="alert">{vm.error}</p>}
    {vm.message && <p role="status">{vm.message}</p>}
    {vm.submittedEmail ? <div className="auth-result">
      <p className="auth-email">{vm.submittedEmail}</p>
      <p className="muted">메일이 오지 않으면 스팸함과 주소를 확인해 주세요. 주소를 수정하거나 다시 요청할 수 있어요.</p>
      <Link to="/login" className="btn pri">인증 후 로그인</Link>
      <button type="button" className="btn" onClick={vm.startOver}>주소 수정·다시 요청</button>
    </div> : <>
      <form className="auth-form" noValidate aria-busy={vm.pending} onSubmit={(event) => { event.preventDefault(); void vm.resend(email) }}>
        <label className="field">이메일<input ref={input} className="inp" name="email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={vm.pending} aria-invalid={!!vm.errors.email} aria-describedby={vm.errors.email ? 'resend-email-error' : undefined} onChange={(event) => setEmail(event.target.value)} /></label>
        {vm.errors.email && <p id="resend-email-error" role="alert">{vm.errors.email}</p>}
        <button className="btn pri" type="submit" disabled={vm.pending}>{vm.pending ? '재발송 중…' : '확인 메일 재발송'}</button>
      </form>
      <div className="lg-links"><Link to="/login">로그인으로</Link></div>
    </>}
  </AuthLayout>
}

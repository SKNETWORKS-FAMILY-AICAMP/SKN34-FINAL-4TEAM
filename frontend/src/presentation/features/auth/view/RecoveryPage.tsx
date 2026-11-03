import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { useRecoveryViewModel } from '../viewmodel/useRecoveryViewModel'
import { AuthLayout } from './AuthLayout'

export function RecoveryPage({ reset = false }: { reset?: boolean }) {
  const vm = useRecoveryViewModel(reset)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => { form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus() }, [vm.errors])
  useEffect(() => { if (vm.state === 'ready' && vm.submittedEmail) form.current?.querySelector<HTMLInputElement>('input')?.focus() }, [vm.state, vm.submittedEmail])
  return <AuthLayout title={reset ? '비밀번호 재설정' : '비밀번호 찾기'} intro={vm.state === 'ready' ? (reset ? '새 비밀번호를 입력해 주세요.' : '가입한 이메일로 재설정 링크를 요청해 주세요.') : undefined}>
    {vm.error && <p role="alert">{vm.error}</p>}
    {vm.message && <p role="status">{vm.message}</p>}
    {!reset && vm.state === 'success' && <div className="auth-result">
      <p className="auth-email">{vm.submittedEmail}</p>
      <p className="muted">메일이 오지 않으면 스팸함과 주소를 확인해 주세요. 주소를 수정하거나 다시 요청할 수 있어요.</p>
      <button type="button" className="btn" onClick={vm.startOver}>주소 수정·다시 요청</button>
    </div>}
    {vm.state === 'ready' && <form ref={form} className="auth-form" noValidate aria-busy={vm.pending} onSubmit={(event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      void vm.submit(String(data.get('email') ?? ''), String(data.get('password') ?? ''), String(data.get('confirmation') ?? ''))
    }}>
      {reset ? <>
        <label className="field">새 비밀번호<input className="inp" name="password" type="password" autoComplete="new-password" required minLength={8} disabled={vm.pending} aria-invalid={!!vm.errors.password} aria-describedby={vm.errors.password ? 'reset-password-help reset-password-error' : 'reset-password-help'} /></label>
        <p id="reset-password-help" className="small muted">8자 이상 입력해 주세요. 공백만으로는 만들 수 없어요.</p>
        <details className="password-help small muted"><summary>비밀번호 길이 안내</summary><p>최대 72바이트(UTF-8)까지 입력할 수 있어요. 한글·이모지는 영문보다 더 많은 공간을 사용해요.</p></details>
        {vm.errors.password && <p id="reset-password-error" role="alert">{vm.errors.password}</p>}
        <label className="field">새 비밀번호 확인<input className="inp" name="confirmation" type="password" autoComplete="new-password" required disabled={vm.pending} aria-invalid={!!vm.errors.confirmation} aria-describedby={vm.errors.confirmation ? 'reset-confirmation-error' : undefined} /></label>
        {vm.errors.confirmation && <p id="reset-confirmation-error" role="alert">{vm.errors.confirmation}</p>}
      </> : <>
        <label className="field">이메일<input className="inp" name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={vm.submittedEmail} disabled={vm.pending} aria-invalid={!!vm.errors.email} aria-describedby={vm.errors.email ? 'recovery-email-error' : undefined} /></label>
        {vm.errors.email && <p id="recovery-email-error" role="alert">{vm.errors.email}</p>}
      </>}
      <button className="btn pri" type="submit" disabled={vm.pending}>{vm.pending ? '처리 중…' : reset ? '비밀번호 변경' : '재설정 메일 요청'}</button>
    </form>}
    <div className="auth-actions">
      {reset && vm.state !== 'success' && <Link to="/auth/forgot-password" className={vm.state === 'invalid' ? 'btn pri' : 'btn'}>새 링크 요청</Link>}
      <Link to="/login" className={reset && vm.state === 'success' ? 'btn pri' : 'btn'}>로그인으로</Link>
    </div>
  </AuthLayout>
}

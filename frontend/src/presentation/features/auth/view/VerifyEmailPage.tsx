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
  return <AuthLayout title="이메일 확인">
    <p role="status">{vm.message}</p>
    {vm.state !== 'pending' && <div className="auth-actions">
      {vm.state === 'error' && <Link to="/auth/resend-verification" className="btn pri">확인 메일 재발송</Link>}
      <Link to="/login" className={vm.state === 'success' ? 'btn pri' : 'btn'}>로그인</Link>
    </div>}
  </AuthLayout>
}

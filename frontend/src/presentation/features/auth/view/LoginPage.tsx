import { Art } from '../../../shared/art'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { useLoginViewModel } from '../viewmodel/useLoginViewModel'

/** 목업 login(): L01 로그인 (회원·관리자 데모 선택은 P-11 정정 전까지 목업 그대로) */
export function LoginPage() {
  const vm = useLoginViewModel()
  const admin = vm.loginRole === 'admin'
  return (
    <div className="lg">
      <section className="lg-l">
        <Go to="/" className="logo" style={{ color: '#fff', border: 0, background: 'none', padding: 0 }}><b>SF</b>STORYFORK</Go>
        <h1>원작을<br />나만의 소설로.</h1>
        <p>읽다가 마음에 드는 회차에서 포크해<br />인물과 함께 다음 회차를 써 보세요.</p>
        <div className="lg-art"><Art theme="star" w={420} h={300} seed="loginart" /></div>
      </section>
      <section className="lg-r">
        <div className="lg-card">
          <Go to="/" className="back" style={{ marginBottom: 18 }}><BackChev />홈으로</Go>
          <h2>로그인</h2>
          <p className="muted small" style={{ margin: '6px 0 18px' }}>로그인하면 소설 읽기, 내 서재, 쓰기를 이용할 수 있어요.</p>
          {vm.loginMsg && <div className="policy" style={{ marginBottom: 14 }}>{vm.loginMsg}</div>}
          <p className="demo-context">시연할 화면을 선택하세요. 실제 계정 인증이나 권한 부여는 이루어지지 않습니다.</p>
          <div className="seg" role="group" aria-label="데모 화면 선택">
            {(['user', 'admin'] as const).map((r) => (
              <button key={r} type="button" className={vm.loginRole === r ? 'on' : ''} aria-pressed={vm.loginRole === r} onClick={() => vm.setRole(r)}>
                {r === 'user' ? '사용자 데모' : '관리자 데모'}
              </button>
            ))}
          </div>
          <form id="lgf" autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}
            onSubmit={(e) => {
              e.preventDefault()
              const f = e.currentTarget
              const email = (f.elements.namedItem('email') as HTMLInputElement).value.trim()
              const pw = f.elements.namedItem('password') as HTMLInputElement
              if (vm.submit(email, pw.value)) pw.value = ''
            }}>
            <label className="field">이메일<input className="inp" name="email" type="email" placeholder={admin ? 'admin@storyfork.demo' : 'reader@storyfork.demo'} /></label>
            <label className="field">비밀번호<input className="inp" name="password" type="password" placeholder="비밀번호" autoComplete="off" /></label>
            <button className="btn pri" style={{ width: '100%', height: 52, fontSize: 16 }} type="submit">{admin ? '관리자로 로그인' : '로그인'}</button>
          </form>
          <button type="button" className="btn" style={{ width: '100%', height: 46, marginTop: 10 }} onClick={vm.demoLogin}>
            {admin ? '데모 관리자 계정으로 들어가기' : '데모 계정으로 바로 시작'}
          </button>
          <div className="lg-links"><Go to="/me/signup">회원가입</Go><span /><Go to="/me/inquiry">로그인 문의</Go></div>
          <p className="note2" style={{ marginTop: 14, textAlign: 'center' }}>데모 로그인이에요. 입력한 값은 저장하거나 전송하지 않아요.</p>
        </div>
      </section>
    </div>
  )
}

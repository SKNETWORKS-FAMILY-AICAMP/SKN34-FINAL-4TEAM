import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { Cov } from '../../../shared/art'
import { openPolicy } from '../../../shared/events'
import { Go } from '../../../shared/Go'
import { RequireRole } from '../../../shared/session/RequireRole'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { Sheet } from '../../../shared/Sheet'
import { ThemeButton } from '../../../shared/shell/ThemeButton'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useAccountViewModel } from '../viewmodel/useAccountViewModel'
import { Devices } from './Devices'

type VM = ReturnType<typeof useAccountViewModel>
const PRIVATE = ['profile', 'liked', 'pay', 'storage']
const TITLE: Record<string, string> = { profile: '프로필', liked: '관심 소설', storage: '저장 공간', pay: '결제 내역', inquiry: '문의하기', notice: '공지사항', event: '이벤트' }

/** 목업 mePage(sub): 로그인 전에는 프로필·관심 소설·결제 내역·저장 공간을 막습니다. */
export function AccountPage() {
  const sub = useParams().sub || 'profile'
  return PRIVATE.includes(sub) ? <RequireRole><Account sub={sub} /></RequireRole> : <Account sub={sub} />
}

/** 목업 meNav(cur) */
function MeNav({ vm, cur }: { vm: VM; cur: string }) {
  const [open, setOpen] = useState(false)
  const L = vm.role ? [['profile', '프로필'], ['liked', '관심 소설'], ['storage', '저장 공간'], ['pay', '결제 내역'], ['inquiry', '문의하기'], ['notice', '공지사항'], ['event', '이벤트']] : [['signup', '회원가입'], ['inquiry', '문의하기'], ['notice', '공지사항'], ['event', '이벤트']]
  return (
    <nav className="menav" aria-label="계정 메뉴">
      <div className="menav-summary"><span>{L.find(([k]) => k === cur)?.[1] || '계정'}</span><button type="button" className="btn sm" aria-expanded={open} aria-controls="account-menu-links" onClick={() => setOpen(!open)}>{open ? '계정 메뉴 닫기' : '계정 메뉴 열기'}</button></div>
      <div id="account-menu-links" className={`menav-links${open ? ' open' : ''}`}>
        {vm.role ? <div className="mewho"><span className="meav">{vm.user.nick.slice(0, 1)}</span><div><b>{vm.user.nick}</b><small>{vm.user.email}</small></div></div>
          : <><div className="mewho"><span className="meav g">?</span><div><b>로그인 전</b><small>로그인하면 더 많은 메뉴가 보여요</small></div></div><Link to="/login" className="btn pri sm" style={{ width: '100%', marginBottom: 8 }} onClick={() => setOpen(false)}>로그인</Link></>}
        {L.map(([k, l]) => <Link key={k} to={`/me/${k}`} className={cur === k ? 'on' : ''} aria-current={cur === k ? 'page' : undefined} onClick={() => setOpen(false)}>{l}</Link>)}
      </div>
    </nav>
  )
}

function Account({ sub }: { sub: string }) {
  const vm = useAccountViewModel(sub)
  useDocumentTitle(TITLE[sub] ?? '계정')
  const [q] = useSearchParams()
  const id = q.get('id')
  const NOTICE = vm.data?.board?.notices ?? [], EVENTS = vm.data?.board?.events ?? []
  let T: ReactNode = null
  if (!vm.data && ['liked', 'notice', 'event'].includes(sub)) T = null
  else if (sub === 'profile') T = vm.profileState === 'ready' ? <Profile vm={vm} /> : <section className="tcard mecard" aria-busy={vm.profileState === 'loading'}>
    <p role={vm.profileState === 'error' ? 'alert' : 'status'}>{vm.profileState === 'loading' ? '프로필을 불러오고 있어요.' : '프로필을 불러오지 못했어요. 다시 시도해 주세요.'}</p>
    {vm.profileState === 'error' && <button type="button" className="btn" onClick={vm.retryProfile}>프로필 다시 시도</button>}
  </section>
  else if (sub === 'liked') T = <><h2>관심 소설 <span className="muted small">{vm.data?.liked.length ?? 0}편</span></h2>{vm.data?.liked.length
    ? <div className="grid6">{vm.data.liked.map((w) => <Go key={w.id} to={`/work/${w.id}`} className="bk prox"><Cov w={w} likes /><span className="hk">{w.title}</span></Go>)}</div>
    : <div className="tcard mecard muted">소설 상세에서 ♡를 누르면 여기에 모여요.</div>}</>
  else if (sub === 'storage') T = vm.data?.storage && <><h2>저장 공간</h2><div className="tcard mecard" data-storage-summary><b>현재 데모 데이터 약 {vm.data.storage.bytes.toLocaleString()}바이트</b>
    <p className="small muted">저장 공간 관리는 MVP에서 제외됐어요. 이 화면에는 브라우저 메모리 기준 예시만 표시하며 새로고침하면 사라져요.</p><h3>작성 중인 초안</h3>
    {vm.data.storage.drafts.length ? vm.data.storage.drafts.map(({ key, title, d }) => <div className="rp" key={key}><b>{title} · {d.editingEpisode ? `${d.editingEpisode}화 수정 초안` : `${d.no}화`}</b></div>) : <p className="muted">작성 중인 초안이 없어요.</p>}</div></>
  else if (sub === 'pay') T = <><h2>결제 내역</h2><div className="kpi" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}><div><small>보유 크레딧</small><b>—</b><span className="small muted">크레딧 정책 미확정 (P2)</span></div><div><small>이번 달 사용</small><b>0</b><span className="small muted">데모에서는 차감되지 않아요</span></div></div>
    <div className="tcard mecard" style={{ marginTop: 14 }}><div className="eptool" style={{ border: 0, padding: 0 }}><div className="sortt"><button type="button" className="on">전체</button><button type="button" disabled title="결제 기능 미정">충전</button><button type="button" disabled title="결제 기능 미정">사용</button></div></div>
      <p className="muted" style={{ padding: '28px 0', textAlign: 'center' }}>결제 내역이 없어요.</p><div className="policy">유료 열람·크레딧 충전은 기획서 V장에서 ‘추후 확정’이라 이 목업에서는 결제가 일어나지 않아요. <button type="button" className="btn sm" onClick={openPolicy}>정책 안내</button></div></div></>
  else if (sub === 'inquiry') T = <InquiryView vm={vm} />
  else if (sub === 'notice' && id !== null) {
    const n = NOTICE[Number(id)]
    T = n ? <><h2>공지사항</h2><article className="tcard mecard"><Go to="/me/notice" className="btn sm">← 목록으로</Go><small className="muted">{n[0]}</small><h3>{n[1]}</h3><p>{n[2]}</p></article></>
      : <><h2>공지사항</h2><p className="note2">공지사항을 찾을 수 없어요.</p><Go to="/me/notice" className="btn sm">목록으로</Go></>
  } else if (sub === 'notice') T = <><h2>공지사항</h2><div className="list">{NOTICE.map((n, i) => <Link key={i} className="ntc" to={`/me/notice?id=${i}`}><b>{n[1]}</b><small>{n[0]}</small></Link>)}</div></>
  else if (sub === 'event' && id !== null) {
    const e = EVENTS[Number(id)]
    T = e ? <><h2>이벤트</h2><article className="tcard mecard" style={{ maxWidth: 740 }}><Go to="/me/event" className="btn sm">← 목록으로</Go><div className="top"><span className={`chip ${e.st === '진행 중' ? 'ok' : 'wait'}`}>{e.st}</span><small className="muted">{e.p}</small></div><h3>{e.t}</h3><p>{e.d}</p><Go to={e.go} className={`btn ${e.st === '진행 중' ? 'pri' : ''}`}>{e.cta} →</Go></article></>
      : <><h2>이벤트</h2><p className="note2">이벤트를 찾을 수 없어요.</p><Go to="/me/event" className="btn sm">목록으로</Go></>
  } else if (sub === 'event') T = <><h2>이벤트 <span className="demo">데모</span></h2><div className="evg">{EVENTS.map((e, i) => (
    <div className="tcard evc" key={i}><Link className="evmain" to={`/me/event?id=${i}`}><div className="top"><span className={`chip ${e.st === '진행 중' ? 'ok' : 'wait'}`}>{e.st}</span><small className="muted">{e.p}</small></div><b>{e.t}</b><p>{e.d}</p></Link><Go to={e.go} className={`btn sm ${e.st === '진행 중' ? 'pri' : ''}`}>{e.cta} →</Go></div>
  ))}</div><p className="note2" style={{ marginTop: 12 }}>보상·경품은 정해지지 않았어요. 이벤트는 기능 체험 안내예요.</p></>
  return (
    <>
      <Gnb on="me" />
      <main id="main" tabIndex={-1} className="wrap"><h1 className="sr-only">내 계정</h1><div className="meg"><MeNav vm={vm} cur={sub} /><section className="mec">{T}</section></div></main>
      <Footer />
    </>
  )
}

function Profile({ vm }: { vm: VM }) {
  const [nick, setNick] = useState(vm.user.nick)
  const [email, setEmail] = useState(vm.user.email)
  const [withdraw, setWithdraw] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const resume = useRef<Element | null>(null)
  useEffect(() => { form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus() }, [vm.profileErrors])
  // 저장 중 입력이 잠기며 초점을 잃었으면, 저장이 끝난 뒤 제출하던 자리로 돌려줍니다.
  useEffect(() => {
    if (vm.saving || !(resume.current instanceof HTMLElement)) return
    if (document.activeElement === document.body) resume.current.focus()
    resume.current = null
  }, [vm.saving])
  return (
    <>
      <h2>프로필</h2>
      <form ref={form} className="tcard mecard auth-form" noValidate aria-busy={vm.saving} onSubmit={(e) => {
        e.preventDefault()
        resume.current = document.activeElement
        void vm.saveProfile(nick, email).then((ok) => { if (ok) { setNick(nick.trim()); setEmail(email.trim()) } })
      }}><div className="mehead"><span className="meav big">{vm.user.nick.slice(0, 1)}</span><div><b>{vm.user.nick}</b>{vm.user.joined && <small>가입일 {vm.user.joined}</small>}</div><div style={{ marginLeft: 'auto' }}><ThemeButton className="btn" /></div></div>
        <label className="field">닉네임<input className="inp" id="pfn" autoComplete="nickname" required disabled={vm.saving} value={nick} maxLength={12} aria-invalid={!!vm.profileErrors.nick} aria-describedby={vm.profileErrors.nick ? 'pfn-error' : undefined} onChange={(e) => setNick(e.target.value)} /></label>
        {vm.profileErrors.nick && <p id="pfn-error" role="alert">{vm.profileErrors.nick}</p>}
        <label className="field">이메일<input className="inp" id="pfe" type="email" autoComplete="email" required disabled={vm.saving} value={email} aria-invalid={!!vm.profileErrors.email} aria-describedby={vm.profileErrors.email ? 'pfe-error' : undefined} onChange={(e) => setEmail(e.target.value)} /></label>
        {vm.profileErrors.email && <p id="pfe-error" role="alert">{vm.profileErrors.email}</p>}
        <p className="small muted">이메일을 변경하면 새 주소의 확인이 끝날 때까지 기존 이메일이 유지돼요.</p>
        {vm.pendingEmail && <p className="small" role="status" style={{ overflowWrap: 'anywhere' }}>{vm.pendingEmail} 주소로 확인 메일을 요청했어요. 확인 전에는 {vm.user.email} 주소를 계속 사용해요.</p>}
        {vm.profileNotice && <p role="status">{vm.profileNotice}</p>}
        {vm.profileError && <p role="alert">{vm.profileError}</p>}
        <div className="rowend"><button type="submit" className="btn pri" id="saveProfile" disabled={vm.saving}>{vm.saving ? '저장 중…' : '저장'}</button></div></form>
      <section className="tcard mecard" aria-labelledby="security-title"><h3 id="security-title">계정 보안</h3><p className="small muted">비밀번호를 바꾸려면 가입한 이메일로 재설정 링크를 요청해 주세요.</p><Link to="/auth/forgot-password" className="btn">비밀번호 재설정</Link></section>
      <Devices />
      <div className="tcard mecard danger"><b>회원탈퇴</b><p className="small muted" style={{ margin: '6px 0 12px' }}>탈퇴 기능은 준비 중이에요. 현재는 실제 계정을 삭제할 수 없으며, 정책 기획안만 확인할 수 있어요.</p><button type="button" className="btn" id="withdrawBtn" onClick={() => setWithdraw(true)}>회원탈퇴</button></div>
      {withdraw && <WithdrawSheet onClose={() => setWithdraw(false)} />}
    </>
  )
}

/** 정책 기획안 안내: 실제 탈퇴·데이터 변경 없음 */
function WithdrawSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet sid="U30" label="회원탈퇴" onClose={onClose}>
      <div className="sh-h"><h3>회원탈퇴</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
      <p>탈퇴 기능은 준비 중이며, 여기서는 실제 계정을 삭제할 수 없어요.</p>
      <div className="policy">정책 기획안: 탈퇴 후 30일 동안 작품·세계관을 숨기고, 이 기간에 다시 로그인하면 복구하도록 계획했어요. 이후 작품·세계관·초안을 삭제하고 댓글·피드백 작성자는 익명 처리하는 내용이에요. 다른 Fork가 참조하는 버전은 보존하고 원작자는 ‘탈퇴한 회원’으로 표시하며, 직접 만든 Fork 작품은 삭제하는 내용도 포함돼요. 현재 구현된 탈퇴 절차가 아니에요.</div>
      <div className="rowend"><button type="button" className="btn" onClick={onClose}>확인</button></div>
    </Sheet>
  )
}

/** 목업 #iqf: U34 문의하기 */
function InquiryView({ vm }: { vm: VM }) {
  const [t, setT] = useState('이용 문의')
  const [s, setS] = useState('')
  const [b, setB] = useState('')
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => { if (vm.inquiry?.ok === false) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus() }, [vm.inquiry])
  const list = vm.data?.inquiries ?? []
  const failed = vm.inquiry?.ok === false
  // 비어 있는 채로 보낸 필드만 오류로 표시하고, 다시 채우면 바로 풀립니다.
  const missing = (value: string) => ({ 'aria-invalid': failed && !value.trim(), 'aria-describedby': failed && !value.trim() ? 'iq-error' : undefined })
  return (
    <>
      <h2>문의하기</h2>
      <form ref={form} className="tcard mecard" id="iqf" noValidate aria-busy={vm.asking} onSubmit={async (e) => { e.preventDefault(); if (await vm.ask(t, s, b)) { setT('이용 문의'); setS(''); setB('') } }}>
        <label className="field">문의 유형<select className="inp" id="iqt" value={t} disabled={vm.asking} onChange={(e) => setT(e.target.value)}>{['이용 문의', '오류 신고', '권리·저작권', '계정', '기타'].map((o) => <option key={o}>{o}</option>)}</select></label>
        <label className="field">제목<input className="inp" id="iqs" maxLength={40} required readOnly={vm.asking} value={s} {...missing(s)} onChange={(e) => setS(e.target.value)} /></label>
        <label className="field">내용<textarea className="ta" id="iqb" maxLength={500} required readOnly={vm.asking} value={b} {...missing(b)} onChange={(e) => setB(e.target.value)} /></label>
        {failed && <p id="iq-error" role="alert">{vm.inquiry?.msg}</p>}
        <div className="rowend"><button className="btn pri" type="submit" id="iqBtn" disabled={vm.asking}>{vm.asking ? '보내는 중…' : '문의 보내기'}</button></div>
      </form>
      {vm.inquiry?.ok && <p role="status">{vm.inquiry.msg}</p>}
      {vm.data && <><h3 className="st" style={{ marginTop: 22 }}>내 문의 {list.length}</h3>
      <div className="list">{list.length ? list.map((x) => (
        <div className="rp" key={x.id}><div className="top"><b>[{x.t}] {x.s}</b><span className={`chip ${x.reply ? 'ok' : 'wait'}`}>{x.st}</span></div><div className="small muted" style={{ marginTop: 4 }}>{x.d} · {x.b}</div>{x.reply && <p className="inquiry-reply"><b>운영팀 답변</b><br />{x.reply}</p>}</div>
      )) : <div className="rp muted">아직 보낸 문의가 없어요.</div>}</div></>}
    </>
  )
}

import { useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { Cov } from '../../../shared/art'
import { openPolicy, toast } from '../../../shared/events'
import { Go } from '../../../shared/Go'
import { RequireRole } from '../../../shared/session/RequireRole'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { Sheet } from '../../../shared/Sheet'
import { useAccountViewModel } from '../viewmodel/useAccountViewModel'

type VM = ReturnType<typeof useAccountViewModel>
const PRIVATE = ['profile', 'liked', 'pay', 'storage']

/** 목업 mePage(sub): 로그인 전에는 프로필·관심 소설·결제 내역·저장 공간을 막습니다. */
export function AccountPage() {
  const sub = useParams().sub || 'profile'
  return PRIVATE.includes(sub) ? <RequireRole><Account sub={sub} /></RequireRole> : <Account sub={sub} />
}

/** 목업 meNav(cur) */
function MeNav({ vm, cur }: { vm: VM; cur: string }) {
  const L = vm.role ? [['profile', '프로필'], ['liked', '관심 소설'], ['storage', '저장 공간'], ['pay', '결제 내역'], ['inquiry', '문의하기'], ['notice', '공지사항'], ['event', '이벤트']] : [['signup', '회원가입'], ['inquiry', '문의하기'], ['notice', '공지사항'], ['event', '이벤트']]
  return (
    <nav className="menav" aria-label="계정 메뉴">
      {vm.role ? <div className="mewho"><span className="meav">{vm.user.nick.slice(0, 1)}</span><div><b>{vm.user.nick}</b><small>{vm.user.email}</small></div></div>
        : <><div className="mewho"><span className="meav g">?</span><div><b>로그인 전</b><small>로그인하면 더 많은 메뉴가 보여요</small></div></div><Go to="/login" className="btn pri sm" style={{ width: '100%', marginBottom: 8 }}>로그인</Go></>}
      {L.map(([k, l]) => <Go key={k} to={`/me/${k}`} className={cur === k ? 'on' : ''} aria-current={cur === k ? 'page' : undefined}>{l}</Go>)}
    </nav>
  )
}

function Account({ sub }: { sub: string }) {
  const vm = useAccountViewModel(sub)
  const [q] = useSearchParams()
  const id = q.get('id')
  const NOTICE = vm.data?.board?.notices ?? [], EVENTS = vm.data?.board?.events ?? []
  let T: ReactNode = null
  if (!vm.data && ['liked', 'notice', 'event'].includes(sub)) T = null
  else if (sub === 'profile') T = <Profile vm={vm} />
  else if (sub === 'signup') T = <Signup vm={vm} />
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
      <main className="wrap"><div className="meg"><MeNav vm={vm} cur={sub} /><section className="mec">{T}</section></div></main>
      <Footer />
    </>
  )
}

function Profile({ vm }: { vm: VM }) {
  const [nick, setNick] = useState(vm.user.nick)
  const [email, setEmail] = useState(vm.user.email)
  const [withdraw, setWithdraw] = useState(false)
  return (
    <>
      <h2>프로필</h2>
      <div className="tcard mecard"><div className="mehead"><span className="meav big">{vm.user.nick.slice(0, 1)}</span><div><b>{vm.user.nick}</b><small>가입일 {vm.user.joined}</small></div></div>
        <label className="field">닉네임<input className="inp" id="pfn" value={nick} maxLength={12} onChange={(e) => setNick(e.target.value)} /></label>
        <label className="field">이메일<input className="inp" id="pfe" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <div className="rowend"><button type="button" className="btn pri" id="saveProfile" onClick={() => { if (vm.saveProfile(nick, email)) { setNick(nick.trim()); setEmail(email.trim()) } }}>저장</button></div></div>
      <div className="tcard mecard danger"><b>회원탈퇴</b><p className="small muted" style={{ margin: '6px 0 12px' }}>탈퇴 시 데이터 처리 기준은 아직 정해지지 않았어요. 이 화면은 실제 계정을 삭제하지 않는 데모입니다.</p><button type="button" className="btn" id="withdrawBtn" onClick={() => setWithdraw(true)}>회원탈퇴</button></div>
      {withdraw && <WithdrawSheet onClose={() => setWithdraw(false)} />}
    </>
  )
}

/** 목업 withdrawSheet(): 실제 탈퇴·데이터 변경 없음 */
function WithdrawSheet({ onClose }: { onClose: () => void }) {
  const [ok, setOk] = useState(false)
  return (
    <Sheet sid="U30" label="회원탈퇴" onClose={onClose}>
      <div className="sh-h"><h3>회원탈퇴</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
      <div className="policy">탈퇴 후 30일 동안 작품·세계관을 숨기며, 다시 로그인하면 복구할 수 있어요. 30일이 지나면 작품·세계관·초안을 삭제하고 댓글·피드백 작성자는 익명 처리해요. 다른 Fork가 참조하는 버전은 보존하고 원작자는 ‘탈퇴한 회원’으로 표시해요. 직접 만든 Fork 작품은 삭제해요. 이 데모에서는 실제 탈퇴나 데이터 변경이 일어나지 않아요.</div>
      <label className="field">떠나시는 이유 (선택)<select className="inp"><option>선택 안 함</option><option>읽을 소설이 부족해요</option><option>쓰기 기능이 불편해요</option><option>다른 서비스를 써요</option></select></label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}><input type="checkbox" id="wdok" checked={ok} onChange={(e) => setOk(e.target.checked)} /> 위 내용을 확인했어요</label>
      <div className="rowend"><button type="button" className="btn" onClick={onClose}>취소</button><button type="button" className="btn danger" id="wdgo" onClick={() => { if (!ok) return toast('확인 항목에 체크해 주세요'); onClose(); toast('탈퇴 확인 데모예요. 실제 계정은 변경되지 않았어요') }}>탈퇴하기</button></div>
    </Sheet>
  )
}

const TERMS = [['[필수] 이용약관 동의', true], ['[필수] 개인정보 수집·이용 동의', true], ['[선택] 이벤트·공지 알림 받기', false]] as const

/** 목업 #suf: U31 회원가입 */
function Signup({ vm }: { vm: VM }) {
  const [f, setF] = useState({ email: '', nick: '', p1: '', p2: '' })
  const [terms, setTerms] = useState([false, false, false])
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <>
      <h2>회원가입</h2>
      <form className="tcard mecard" id="suf" autoComplete="off" onSubmit={(e) => { e.preventDefault(); vm.signup({ ...f, termsOk: TERMS.every(([, req], i) => !req || terms[i]) }) }}>
        <label className="field">이메일<input className="inp" id="sue" type="email" placeholder="name@example.com" value={f.email} onChange={set('email')} /></label>
        <label className="field">닉네임<input className="inp" id="sun" maxLength={12} placeholder="2~12자" value={f.nick} onChange={set('nick')} /></label>
        <label className="field">비밀번호<input className="inp" id="sup" type="password" placeholder="8자 이상" autoComplete="new-password" value={f.p1} onChange={set('p1')} /></label>
        <label className="field">비밀번호 확인<input className="inp" id="sup2" type="password" autoComplete="new-password" value={f.p2} onChange={set('p2')} /></label>
        <div className="terms">
          <label><input type="checkbox" id="tall" checked={terms.every(Boolean)} onChange={(e) => setTerms(terms.map(() => e.target.checked))} /> <b>전체 동의</b></label>
          {TERMS.map(([l], i) => <label key={l}><input type="checkbox" className="tm" checked={terms[i]} onChange={(e) => setTerms(terms.map((x, j) => (j === i ? e.target.checked : x)))} /> {l}</label>)}
        </div>
        <p className="note2">데모 화면이라 입력한 비밀번호는 저장하지 않아요.</p>
        <button className="btn pri" style={{ width: '100%', height: 50 }} type="submit" id="signupBtn">가입하고 시작하기</button>
      </form>
    </>
  )
}

/** 목업 #iqf: U34 문의하기 */
function InquiryView({ vm }: { vm: VM }) {
  const [t, setT] = useState('이용 문의')
  const [s, setS] = useState('')
  const [b, setB] = useState('')
  const list = vm.data?.inquiries ?? []
  return (
    <>
      <h2>문의하기</h2>
      <form className="tcard mecard" id="iqf" onSubmit={async (e) => { e.preventDefault(); if (await vm.ask(t, s, b)) { setT('이용 문의'); setS(''); setB('') } }}>
        <label className="field">문의 유형<select className="inp" id="iqt" value={t} onChange={(e) => setT(e.target.value)}>{['이용 문의', '오류 신고', '권리·저작권', '계정', '기타'].map((o) => <option key={o}>{o}</option>)}</select></label>
        <label className="field">제목<input className="inp" id="iqs" maxLength={40} value={s} onChange={(e) => setS(e.target.value)} /></label>
        <label className="field">내용<textarea className="ta" id="iqb" maxLength={500} value={b} onChange={(e) => setB(e.target.value)} /></label>
        <div className="rowend"><button className="btn pri" type="submit" id="iqBtn">문의 보내기</button></div>
      </form>
      {vm.data && <><h3 className="st" style={{ marginTop: 22 }}>내 문의 {list.length}</h3>
      <div className="list">{list.length ? list.map((x) => (
        <div className="rp" key={x.id}><div className="top"><b>[{x.t}] {x.s}</b><span className={`chip ${x.reply ? 'ok' : 'wait'}`}>{x.st}</span></div><div className="small muted" style={{ marginTop: 4 }}>{x.d} · {x.b}</div>{x.reply && <p className="inquiry-reply"><b>운영팀 답변</b><br />{x.reply}</p>}</div>
      )) : <div className="rp muted">아직 보낸 문의가 없어요.</div>}</div></>}
    </>
  )
}

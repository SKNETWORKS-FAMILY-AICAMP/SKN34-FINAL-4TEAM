import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { supportStatusLabel } from '../../../../domain/entities/supportInquiry'
import { Cov } from '../../../shared/art'
import { EventStatusChip } from '../../../shared/EventStatusChip'
import { kstDateTime, kstPeriod } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { RequireRole } from '../../../shared/session/RequireRole'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { Sheet } from '../../../shared/Sheet'
import { ThemeButton } from '../../../shared/shell/ThemeButton'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useAccountViewModel } from '../viewmodel/useAccountViewModel'
import { Devices } from './Devices'
import { PayView } from './PayView'

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
  let T: ReactNode = null
  if (sub === 'notice') T = <NoticeBoard vm={vm} id={id} />
  else if (sub === 'event') T = <EventBoard vm={vm} id={id} />
  else if ((sub === 'liked' || sub === 'storage') && (vm.loadFailed || !vm.data)) T = <LoadState title={TITLE[sub]} failed={vm.loadFailed} retry={vm.retryLoad} />
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
  else if (sub === 'pay') T = <PayView vm={vm} />
  else if (sub === 'inquiry') T = <InquiryView vm={vm} />
  return (
    <>
      <Gnb on="me" />
      <main id="main" tabIndex={-1} className="wrap"><h1 className="sr-only">내 계정</h1><div className="meg"><MeNav vm={vm} cur={sub} /><section className="mec">{T}</section></div></main>
      <Footer />
    </>
  )
}

/** 관심 소설·저장 공간의 조회 중·실패. 빈 화면이나 0건으로 보이지 않게 실제 상태를 알리고 다시 불러오게 합니다. */
function LoadState({ title, failed, retry }: { title: string; failed: boolean; retry: () => void }) {
  return <><h2>{title}</h2>{failed
    ? <><p role="alert">{title}을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button type="button" className="btn sm" onClick={retry}>다시 불러오기</button></>
    : <p role="status">{title}을 불러오고 있어요.</p>}</>
}

const noticeDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' })
const noticeDate = (iso: string) => noticeDay.format(new Date(iso)).replaceAll('-', '.')

/** U35 공지사항: 운영 공지 API(로그인 불필요)의 목록·상세. 로딩·실패·없음은 실제 조회 결과대로 보입니다. */
function NoticeBoard({ vm, id }: { vm: VM; id: string | null }) {
  const { data } = vm
  let body: ReactNode
  if (vm.loadFailed) body = <><p role="alert">공지사항을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button type="button" className="btn sm" onClick={vm.retryLoad}>다시 불러오기</button></>
  else if (!data) body = <p role="status">공지사항을 불러오고 있어요.</p>
  else if (id === null) body = data.notices.length
    ? <div className="list">{data.notices.map((n) => <Link key={n.id} className="ntc" to={`/me/notice?id=${n.id}`}><b>{n.title}</b><small>{noticeDate(n.createdAt)}</small></Link>)}</div>
    : <p className="note2">등록된 공지사항이 없어요.</p>
  else body = data.notice
    ? <article className="tcard mecard"><Go to="/me/notice" className="btn sm">← 목록으로</Go><small className="muted">{noticeDate(data.notice.createdAt)}</small><h3>{data.notice.title}</h3><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data.notice.body}</p></article>
    : <><p className="note2">공지사항을 찾을 수 없어요.</p><Go to="/me/notice" className="btn sm">목록으로</Go></>
  return <><h2>공지사항</h2>{body}</>
}

const CLAMP: CSSProperties = { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }
const PROSE: CSSProperties = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }

/** U35E 이벤트: 운영 공개 API의 목록과 UUID 상세. 참여·보상·기능 이동은 연결하지 않았습니다. */
function EventBoard({ vm, id }: { vm: VM; id: string | null }) {
  if (vm.loadFailed) return <><h2>이벤트</h2><p role="alert">이벤트를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button type="button" className="btn" onClick={vm.retryLoad}>다시 불러오기</button></>
  if (!vm.data) return <><h2>이벤트</h2><p role="status" className="note2">이벤트를 불러오고 있어요.</p></>
  const { events, event } = vm.data
  if (id !== null) return event
    ? <><h2>이벤트</h2><article className="tcard mecard" style={{ maxWidth: 740 }}><Go to="/me/event" className="btn sm">← 목록으로</Go><div className="top"><EventStatusChip status={vm.eventStatusNow(event)} /><small className="muted">{kstPeriod(event)}</small></div><h3>{event.title}</h3><p style={PROSE}>{event.body}</p></article></>
    : <><h2>이벤트</h2><p className="note2">이벤트를 찾을 수 없어요.</p><Go to="/me/event" className="btn sm">목록으로</Go></>
  return <><h2>이벤트</h2>{events.length
    ? <div className="evg">{events.map((e) => (
      <div className="tcard evc" key={e.id}><Link className="evmain" to={`/me/event?id=${e.id}`}><div className="top"><EventStatusChip status={vm.eventStatusNow(e)} /><small className="muted">{kstPeriod(e)}</small></div><b>{e.title}</b><p style={CLAMP}>{e.body}</p></Link></div>
    ))}</div>
    : <p className="note2">등록된 이벤트가 없어요.</p>}<p className="note2" style={{ marginTop: 12 }}>보상·경품은 정해지지 않았어요. 이벤트는 기능 체험 안내예요.</p></>
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
        <p className="small muted">모든 항목은 필수예요.</p>
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
      <section className="tcard mecard danger" aria-labelledby="withdraw-title"><h3 id="withdraw-title">회원탈퇴</h3><p className="small muted" style={{ margin: '6px 0 12px' }}>탈퇴 기능은 준비 중이에요. 현재는 실제 계정을 삭제할 수 없으며, 정책 기획안만 확인할 수 있어요.</p><button type="button" className="btn" id="withdrawBtn" onClick={() => setWithdraw(true)}>회원탈퇴</button></section>
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

/** 목업 #iqf: U34 문의하기. 로그인한 회원만 운영 서버에 접수하고 내 문의·답변을 읽습니다. */
function InquiryView({ vm }: { vm: VM }) {
  return (
    <>
      <h2>문의하기</h2>
      {vm.role ? <InquiryForm vm={vm} /> : vm.restoring ? <p role="status">로그인 상태를 확인하고 있어요.</p> : (
        <section className="tcard mecard" aria-labelledby="iq-login-title">
          <h3 id="iq-login-title">로그인한 뒤 문의할 수 있어요</h3>
          <p className="small muted">문의와 운영팀 답변은 회원 계정에 연결돼요. 로그인하면 문의를 보내고 내 문의에서 답변을 확인할 수 있어요.</p>
          <Link to="/login" className="btn pri" onClick={vm.requireLogin}>로그인하고 문의하기</Link>
        </section>
      )}
    </>
  )
}

function InquiryForm({ vm }: { vm: VM }) {
  const [t, setT] = useState('이용 문의')
  const [s, setS] = useState('')
  const [b, setB] = useState('')
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => { if (vm.inquiry?.ok === false) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus() }, [vm.inquiry])
  const list = vm.mine.data ?? []
  const failed = vm.inquiry?.ok === false
  // 비어 있는 채로 보낸 필드만 오류로 표시하고, 다시 채우면 바로 풀립니다.
  const missing = (value: string) => ({ 'aria-invalid': failed && !value.trim(), 'aria-describedby': failed && !value.trim() ? 'iq-error' : undefined })
  return (
    <>
      <p className="small muted">보낸 문의와 운영팀 답변은 아래 내 문의에서 확인해요. 답변 알림은 따로 보내지 않아요.</p>
      <form ref={form} className="tcard mecard" id="iqf" noValidate aria-busy={vm.asking} onSubmit={async (e) => { e.preventDefault(); if (await vm.ask(t, s, b)) { setT('이용 문의'); setS(''); setB('') } }}>
        <p className="small muted">모든 항목은 필수예요.</p>
        <label className="field">문의 유형<select className="inp" id="iqt" value={t} disabled={vm.asking} onChange={(e) => setT(e.target.value)}>{['이용 문의', '오류 신고', '권리·저작권', '계정', '기타'].map((o) => <option key={o}>{o}</option>)}</select></label>
        <label className="field">제목<input className="inp" id="iqs" maxLength={200} required readOnly={vm.asking} value={s} {...missing(s)} onChange={(e) => setS(e.target.value)} /></label>
        <label className="field">내용<textarea className="ta" id="iqb" maxLength={20000} required readOnly={vm.asking} value={b} {...missing(b)} onChange={(e) => setB(e.target.value)} /></label>
        {failed && <p id="iq-error" role="alert">{vm.inquiry?.msg}</p>}
        <div className="rowend"><button className="btn pri" type="submit" id="iqBtn" disabled={vm.asking}>{vm.asking ? '보내는 중…' : '문의 보내기'}</button></div>
      </form>
      {vm.inquiry?.ok && <p role="status">{vm.inquiry.msg}</p>}
      <h3 className="st" style={{ marginTop: 22 }}>내 문의{vm.mine.data ? ` ${list.length}` : ''}</h3>
      {vm.mine.isLoading && <p role="status">내 문의를 불러오고 있어요.</p>}
      {vm.mine.isError && <div role="alert"><p>내 문의를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button type="button" className="btn sm" onClick={vm.mine.retry}>다시 불러오기</button></div>}
      {vm.mine.data && <div className="list">{list.length ? list.map((x) => (
        <div className="rp" key={x.id} style={{ overflowWrap: 'anywhere' }}><div className="top"><b>[{x.category}] {x.title}</b><span className={`chip ${x.status === 'ANSWERED' ? 'ok' : 'wait'}`}>{supportStatusLabel(x.status)}</span></div>
          <div className="small muted" style={{ marginTop: 4 }}>{kstDateTime(x.createdAt)}</div>
          <p className="small" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{x.body}</p>
          {x.replies.map((r, i) => <p className="inquiry-reply" key={r.id}><b>운영팀 답변{x.replies.length > 1 ? ` ${i + 1}` : ''}</b><br />{r.body}</p>)}</div>
      )) : <div className="rp muted">아직 보낸 문의가 없어요.</div>}</div>}
    </>
  )
}

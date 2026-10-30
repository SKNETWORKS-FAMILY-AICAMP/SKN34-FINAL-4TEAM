import { useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { ADMIN_PERMISSIONS, adminTab, type AdminTab } from '../../../../domain/entities/admin'
import { Go } from '../../../shared/Go'
import { useAdminViewModel } from '../viewmodel/useAdminViewModel'

type VM = ReturnType<typeof useAdminViewModel>
type Data = NonNullable<VM['data']>
type Filter = { category: string; sort: string; query: string; search: string }

const GROUPS: [string, [AdminTab, string][]][] = [['현황', [['data', '개요']]], ['콘텐츠 관리', [['users', '사용자'], ['works', '작품'], ['comments', '댓글'], ['characterChats', '캐릭터챗']]], ['소통 관리', [['feedback', '제보·문의'], ['events', '이벤트'], ['notices', '공지']]], ['서비스 운영', [['llm', 'LLM Ops'], ['jobs', '정기 작업'], ['rights', '신고·권리'], ['credits', '크레딧'], ['audit', '활동 로그']]], ['계정', [['profile', '프로필'], ['admins', '관리자 계정·권한']]]]
const TITLES: Record<AdminTab, [string, string]> = {
  data: ['관리 개요', '수집 자료와 서비스 상태를 확인합니다.'], rights: ['신고·권리 관리', '신고·권리 조치와 원작·Fork 격리를 확인합니다.'], llm: ['LLM Ops', 'LLM 운영 지표는 시연용 예시이며 실시간 연결은 없습니다.'],
  admins: ['관리자 계정과 권한', '업무별 접근 권한을 나누어 관리자 계정을 추가합니다.'], users: ['사용자 관리', '데모 계정의 상태를 확인하고 제한할 수 있어요.'], works: ['작품 관리', '등록 작품의 공개 상태와 이용 권리 정보를 살펴봅니다.'],
  characterChats: ['캐릭터챗 관리', '공개 작품의 원작·포크와 캐릭터를 선택해 챗을 추가하거나 운영 상태를 바꿉니다.'], comments: ['댓글 관리', '댓글 목록을 확인하고 데모 상태에서 숨김 처리할 수 있어요.'], feedback: ['제보·문의', '오류 제보와 사용자 문의를 한곳에서 확인합니다.'],
  jobs: ['정기 작업', 'Core API 내장 스케줄러에서 관리할 작업 흐름을 확인합니다.'], events: ['이벤트 관리', '이벤트를 안내하고 진행 상태를 바꿉니다.'], notices: ['공지 게시', '회원 화면의 공지 목록에 데모 게시물을 추가합니다.'],
  credits: ['크레딧 관리', '크레딧 이용 현황과 정책 확정 상태를 확인합니다.'], audit: ['관리자 활동 로그', '이 화면에서 수행한 데모 조치를 최신순으로 기록합니다.'], profile: ['관리자 프로필', '관리자 계정의 표시 이름과 이메일을 관리합니다.'],
}
const KINDS: [string, string][] = [['all', '전체'], ['original', '원작'], ['fork', '포크']]
const byKind = (k: string, fork: boolean) => k === 'all' || (k === 'fork' ? fork : !fork)
const has = (q: string, ...xs: string[]) => !q || xs.join(' ').toLocaleLowerCase().includes(q.toLocaleLowerCase())
/** 폼 입력값을 이름으로 읽습니다 (목업 $('#id').value). */
const val = (e: FormEvent<HTMLFormElement>, name: string) => (e.currentTarget.elements.namedItem(name) as HTMLInputElement).value

/** 목업 admin(): 자체 상단바·업무 메뉴. 데모 화면 가림일 뿐이며 실제 권한 검사는 Core가 맡아야 합니다. */
export function AdminPage() {
  const [q] = useSearchParams()
  const tab = adminTab(q.get('tab'))
  const [sel, setSel] = useState<string | null>(null)
  const vm = useAdminViewModel(tab, sel)
  const [filters, setFilters] = useState<Record<string, Filter>>({})
  const f = filters[tab] ?? { category: 'all', sort: tab === 'users' ? 'newest' : tab === 'comments' ? 'likes' : 'title', query: '', search: '' }
  const setF = (x: Partial<Filter>) => setFilters({ ...filters, [tab]: { ...f, ...x } })
  const d = vm.data
  const [title, desc] = TITLES[tab]
  return (
    <div className="adm">
      <div className="top"><div className="wrap in"><b style={{ fontSize: 16 }}>STORYFORK 관리자</b><span style={{ marginLeft: 'auto', fontSize: 12.5, color: '#D4D1E2' }}>관리자 전용 계정</span><Go to="/admin?tab=profile" className="btn sm" style={{ background: 'rgba(255,255,255,.1)', color: '#fff', border: 0 }}>{d?.admin.profile.nick ?? '관리자'} · 프로필</Go></div></div>
      <main className="wrap"><div className="shell">
        <nav className="admin-nav" aria-label="관리자 업무">
          {GROUPS.map(([g, items]) => <section key={g} aria-label={g}><h2>{g}</h2>{items.map(([k, l]) => <Go key={k} to={`/admin?tab=${k}`} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined}>{l}</Go>)}</section>)}
          <button type="button" onClick={vm.logout}>로그아웃</button>
        </nav>
        <section className="workspace">
          <header className="admin-head"><div><h1>{title}</h1><p>{desc}</p></div><span className="demo">데모 화면</span></header>
          {d && <Body key={tab} tab={tab} d={d} vm={vm} f={f} setF={setF} sel={sel} setSel={setSel} />}
          <p className="admin-note">이 관리자 UI는 오프라인 데모입니다. 실제 권한 확인과 데이터 반영은 서버 연결이 필요합니다.</p>
        </section>
      </div></main>
    </div>
  )
}

type BodyProps = { tab: AdminTab; d: Data; vm: VM; f: Filter; setF: (x: Partial<Filter>) => void; sel: string | null; setSel: (s: string) => void }

/** 목업 adminExtra()의 controls(): 분류·정렬과 (작품·댓글·캐릭터챗) 검색 */
function Controls({ tab, f, setF, categories, sorts }: Pick<BodyProps, 'tab' | 'f' | 'setF'> & { categories: [string, string][]; sorts: [string, string][] }) {
  const label = tab === 'works' ? '작품 검색' : tab === 'comments' ? '댓글 검색' : '캐릭터챗 검색'
  return (
    <>
      <div className="table-head"><label className="field">분류<select className="inp" value={f.category} onChange={(e) => setF({ category: e.target.value })}>{categories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="field">정렬<select className="inp" value={f.sort} onChange={(e) => setF({ sort: e.target.value })}>{sorts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label></div>
      {['works', 'comments', 'characterChats'].includes(tab) && <form className="admin-search" onSubmit={(e) => { e.preventDefault(); setF({ query: val(e, 'query').trim() }) }}>
        <label className="field">{label}<input className="inp" name="query" defaultValue={f.query} placeholder={tab === 'works' ? '작품명·작성자·권리 유형' : tab === 'comments' ? '댓글 내용·작품명·작성자' : '작품명·캐릭터'} /></label><button className="btn sm pri" type="submit">검색</button></form>}
    </>
  )
}

function Body(p: BodyProps) {
  const { tab, d, vm, f } = p
  const titleSort = (a: string, b: string) => (f.sort === 'titleDesc' ? b.localeCompare(a, 'ko') : a.localeCompare(b, 'ko'))
  let T: ReactNode
  if (tab === 'data') T = <Overview d={d} />
  else if (tab === 'rights') T = <Rights {...p} />
  else if (tab === 'llm') T = <Llm d={d} vm={vm} />
  else if (tab === 'admins') T = <Admins d={d} vm={vm} />
  else if (tab === 'users') {
    const list = d.admin.users.filter((u) => f.category === 'all' || u.role === f.category).sort((a, b) => (f.sort === 'oldest' ? a.joined.localeCompare(b.joined) : b.joined.localeCompare(a.joined)))
    const s = f.search.trim().toLocaleLowerCase()
    T = <div className="panel"><Controls {...p} categories={[['all', '전체'], ...[...new Set(d.admin.users.map((u) => u.role))].map((v): [string, string] => [v, v])]} sorts={[['newest', '가입 최신순'], ['oldest', '가입 오래된순']]} />
      <div className="table-head"><span className="demo">예시 계정 · 실제 회원 데이터 아님</span><label className="field" style={{ margin: 0, maxWidth: 300 }}>사용자 검색<input className="inp" type="search" value={f.search} placeholder="이름·이메일 검색" onChange={(e) => p.setF({ search: e.target.value })} /></label></div>
      <table><thead><tr><th>사용자</th><th>역할</th><th>가입일</th><th>상태</th><th>조치</th></tr></thead><tbody>{list.map((u) => (
        <tr key={u.id} hidden={!!s && !(u.nick + u.email + u.role + u.joined + u.status).toLocaleLowerCase().includes(s)}><td><b>{u.nick}</b><br /><span className="small muted">{u.email}</span></td><td>{u.role}</td><td>{u.joined}</td><td><span className={`chip ${u.status === '활동' ? 'ok' : 'wait'}`}>{u.status}</span></td><td><button type="button" className="btn sm" onClick={() => vm.toggleUser(u.id)}>{u.status === '활동' ? '이용 제한' : '제한 해제'}</button></td></tr>
      ))}</tbody></table><p className="admin-note">상태 변경은 이 브라우저의 데모 화면에만 반영됩니다. 실제 계정 권한은 서버 연동이 필요해요.</p></div>
  } else if (tab === 'works') {
    const list = d.works.filter((w) => byKind(f.category, !!w.parent) && has(f.query, w.title, w.author, w.kind, w.rights)).sort((a, b) => titleSort(a.title, b.title))
    T = <div className="panel"><span className="demo">목업 작품 데이터</span><Controls {...p} categories={KINDS} sorts={[['title', '제목순'], ['titleDesc', '제목 역순']]} />
      <table style={{ marginTop: 10 }}><thead><tr><th>작품</th><th>작성자</th><th>종류</th><th>권리</th><th>공개 상태</th><th>조치</th></tr></thead><tbody>{list.length ? list.map((w) => (
        <tr key={w.id}><td><b>{w.title}</b></td><td>{w.author}</td><td>{w.kind}</td><td>{w.rights}</td><td><span className={`chip ${w.hidden ? 'wait' : 'ok'}`}>{w.hidden ? '운영 제한' : w.private ? '비공개' : '공개'}</span></td><td><button type="button" className="btn sm" onClick={() => vm.toggleWork(w.id)}>{w.hidden ? '제한 해제' : '운영상 비공개'}</button></td></tr>
      )) : <tr><td colSpan={6} className="muted">검색 결과가 없어요.</td></tr>}</tbody></table><p className="admin-note">공개 제한은 데모 작품 상태에만 반영되고, 실제 작품 권한 판단은 Core API에서 처리해야 합니다.</p></div>
  } else if (tab === 'characterChats') {
    const list = d.chats.filter((c) => byKind(f.category, !!c.w.parent) && has(f.query, c.w.title, c.character)).sort((a, b) => titleSort(a.w.title, b.w.title) || a.character.localeCompare(b.character, 'ko'))
    T = <><ChatForm d={d} vm={vm} /><div className="panel" style={{ marginTop: 14 }}><div className="table-head"><b>캐릭터챗 목록</b><span className="demo">작품·캐릭터 연결</span></div><Controls {...p} categories={KINDS} sorts={[['title', '작품 제목순'], ['titleDesc', '작품 제목 역순']]} />
      <table style={{ marginTop: 10 }}><thead><tr><th>구분</th><th>작품</th><th>캐릭터</th><th>상태</th><th>관리</th></tr></thead><tbody>{list.length ? list.map((c) => (
        <tr key={c.id}><td><span className={`chip ${c.w.parent ? 'if' : 'ok'}`}>{c.w.parent ? '포크' : '원작'}</span></td><td><b>{c.w.title}</b></td><td>{c.character}</td><td><span className={`chip ${c.enabled === false ? 'wait' : 'ok'}`}>{c.enabled === false ? '중지' : '운영 중'}</span></td><td><button type="button" className="btn sm" onClick={() => vm.toggleChat(c.id)}>{c.enabled === false ? '운영 재개' : '중지'}</button></td></tr>
      )) : <tr><td colSpan={5} className="muted">조건에 맞는 캐릭터챗이 없어요.</td></tr>}</tbody></table></div></>
  } else if (tab === 'comments') {
    const works = [...new Map(d.comments.map((c) => [c.workId, c.work])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'))
    const list = d.comments.filter((c) => (f.category === 'all' || c.workId === f.category) && has(f.query, c.text, c.work, c.author)).sort((a, b) => (f.sort === 'likes' ? b.likes - a.likes : a.likes - b.likes))
    T = <div className="panel"><span className="demo">시드·현재 브라우저 댓글 · 서버 저장 없음</span><Controls {...p} categories={[['all', '전체 작품'], ...works.map(([id, name]): [string, string] => [id, works.filter((x) => x[1] === name).length > 1 ? name + ' · ' + id : name])]} sorts={[['likes', '공감 많은순'], ['likesAsc', '공감 적은순']]} />
      <table style={{ marginTop: 10 }}><thead><tr><th>댓글</th><th>작품</th><th>작성자</th><th>공감</th><th>상태</th><th>조치</th></tr></thead><tbody>{list.length ? list.map((c) => (
        <tr key={c.id}><td>{c.text}</td><td>{c.work}</td><td>{c.author}</td><td>{c.likes}</td><td><span className={`chip ${c.status === '게시' ? 'ok' : 'wait'}`}>{c.status}</span></td><td><button type="button" className="btn sm" onClick={() => vm.toggleComment(c.id, c.work + ' · ' + c.author)}>{c.status === '게시' ? '숨김' : '게시 복구'}</button></td></tr>
      )) : <tr><td colSpan={6} className="muted">검색 결과가 없어요.</td></tr>}</tbody></table></div>
  } else if (tab === 'feedback') T = <Feedback d={d} vm={vm} />
  else if (tab === 'jobs') T = <div className="panel"><div className="table-head"><b>운영 정기 작업</b><span className="demo">데모 기록 · 실제 실행 없음</span></div><p className="admin-note">기획 구조는 Core API 내장 스케줄러예요. 실행 주기는 미정이며, 별도 worker·queue는 추가하지 않아요. 사용자가 요청한 AI 작업은 자동 재처리하지 않습니다.</p>
    <table><thead><tr><th>작업</th><th>실행 주기</th><th>최근 상태</th><th>최근 결과</th><th>조치</th></tr></thead><tbody>{d.admin.jobs.map((j) => (
      <tr key={j.id}><td><b>{j.name}</b></td><td>미정</td><td><span className={`chip ${j.status === '실패' ? 'wait' : 'ok'}`}>{j.status}</span></td><td>{j.last}</td><td>{j.status === '실패' ? <button type="button" className="btn sm" onClick={() => vm.runJob(j.id)}>수동 재시도 시연</button> : '—'}</td></tr>
    ))}</tbody></table><p className="admin-note">실패 작업은 명시적인 수동 재시도만 표시합니다. 재시도 동작은 멱등하게 설계해야 하며, 이 화면의 버튼은 실제 작업을 실행하지 않습니다.</p></div>
  else if (tab === 'events') T = <>
    <form className="panel" onSubmit={async (e) => { e.preventDefault(); const form = e.currentTarget; if (await vm.addEvent(val(e, 'title'), val(e, 'period'), val(e, 'body'))) form.reset() }}><b>이벤트 추가</b><div className="form-grid" style={{ marginTop: 12 }}><label className="field">이벤트명<input className="inp" name="title" maxLength={50} required /></label><label className="field">기간<input className="inp" name="period" maxLength={40} placeholder="기간 미정" /></label><label className="field wide">안내 내용<textarea className="ta" name="body" maxLength={300} required /></label></div><div className="rowend"><button className="btn pri" type="submit">이벤트 추가</button></div></form>
    <div className="panel" style={{ marginTop: 14 }}><span className="demo">데모에서만 추가·변경</span><table style={{ marginTop: 10 }}><thead><tr><th>이벤트</th><th>기간</th><th>상태</th><th>조치</th></tr></thead><tbody>{d.admin.events.map((e, i) => (
      <tr key={i}><td><b>{e.t}</b><br /><span className="small muted">{e.d}</span></td><td>{e.p}</td><td>{e.st}</td><td><button type="button" className="btn sm" onClick={() => vm.toggleEvent(i)}>상태 변경</button></td></tr>
    ))}</tbody></table></div></>
  else if (tab === 'notices') T = <>
    <form className="panel" onSubmit={async (e) => { e.preventDefault(); const form = e.currentTarget; if (await vm.addNotice(val(e, 'title'), val(e, 'body'))) form.reset() }}><b>공지 작성</b><div className="form-grid" style={{ marginTop: 12 }}><label className="field wide">제목<input className="inp" name="title" maxLength={60} required /></label><label className="field wide">내용<textarea className="ta" name="body" maxLength={1000} required /></label></div><div className="rowend"><button className="btn pri" type="submit">공지 게시</button></div></form>
    <div className="panel" style={{ marginTop: 14 }}><span className="demo">데모에서만 게시</span><table style={{ marginTop: 10 }}><thead><tr><th>게시일</th><th>제목</th><th>내용</th></tr></thead><tbody>{d.admin.notices.map((n, i) => <tr key={i}><td>{n[0]}</td><td><b>{n[1]}</b></td><td>{n[2]}</td></tr>)}</tbody></table></div></>
  else if (tab === 'credits') T = <div className="panel"><div className="table-head"><b>크레딧 원장</b><span className="chip wait">정책 미확정</span></div><p>현재 실제 잔액·충전·차감 내역은 연결되어 있지 않습니다.</p><table style={{ marginTop: 14 }}><thead><tr><th>일시</th><th>계정</th><th>유형</th><th>변동</th><th>상태</th></tr></thead><tbody><tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>표시할 실제 내역이 없어요.</td></tr></tbody></table><p className="admin-note">충전·회수·수동 조정은 정책, 권한, 복구 기준이 확정된 뒤 연결해야 합니다. 이 화면에서는 크레딧을 변경하지 않습니다.</p></div>
  else if (tab === 'audit') T = <div className="panel"><ul className="audit-list">{d.admin.audit.length ? d.admin.audit.map((x, i) => <li key={i}><time>{x.at}</time><div><b>{x.action}</b><div className="small muted">{x.actor} · {x.detail}</div></div></li>) : <li className="muted">아직 기록된 조치가 없어요.</li>}</ul><p className="admin-note">기록은 현재 브라우저 메모리에만 있으며 새로고침하면 사라집니다.</p></div>
  else T = <Profile d={d} vm={vm} />
  return T
}

/** 목업 adminLegacy() tab=data: A01+A02 */
function Overview({ d }: { d: Data }) {
  return <>
    <div className="admin-priorities"><div><h2>확인할 작업</h2><p>데모에 접수된 항목부터 확인하세요.</p></div><div className="priority-links"><Go to="/admin?tab=feedback"><b>{d.inquiries.filter((q) => q.st === '답변 대기').length}</b><span>답변 대기 문의</span></Go><Go to="/admin?tab=rights"><b>{d.queue.filter((q) => q.status === '접수').length}</b><span>접수된 신고</span></Go></div></div>
    <h2 className="admin-section-title">데이터 시연 현황</h2>
    <div className="kpi"><div><small>수집 원작 (만료·등록)</small><b>{d.expired.length}편</b><span className="small muted">{d.expired.map((w) => w.title).join(', ')}</span></div><div><small>가상 독자 댓글</small><b>300건</b><span className="small muted">유형 라벨 포함 · LLM 생성 (데모)</span></div><div><small>전처리 결과 JSON</small><b>{1 + Number(d.imported)}개</b><span className="small muted">구운몽{d.imported ? ' + 가져온 소설' : ''}</span></div><div><small>처리 대기 제보</small><b>{d.pending}건</b><span className="small muted">수정 제안 + 작가 확인 필요</span></div></div>
    <div className="panel" style={{ marginTop: 14 }}><b>전처리 6단계 · 구운몽 시연 흐름</b><div className="flow" style={{ marginTop: 12 }}>{[['수집', '원문 txt'], ['정제', '특수·불용 문자 제거'], ['회차 분할', '16장 → 4화'], ['LLM 추출', '인물·관계·세계관·사건'], ['검수', '작가·관리자 확인'], ['결과', 'JSON 목업']].map(([a, b], i) => <div key={a} className={i < 4 || d.imported ? 'done' : ''}><b>{i + 1}. {a}</b>{b}</div>)}</div><p className="small" style={{ marginTop: 10, color: 'var(--pri-ink)' }}>실제 LLM 호출은 연결되지 않았으며, 이 파이프라인은 목표 흐름을 보여 주는 시연용입니다.</p></div>
    <div className="panel" style={{ marginTop: 14 }}><b>수집 데이터 명세</b><table style={{ marginTop: 10 }}><tbody><tr><th>데이터</th><th>출처</th><th>양</th><th>형식</th><th>쓰는 곳</th></tr><tr><td>구운몽 전문</td><td>공유마당 만료 저작물</td><td>1편 · 16장</td><td>txt · 412KB</td><td>세계관·인물 추출, 읽기 화면</td></tr><tr><td>가상 독자 댓글</td><td>LLM 생성 (비상업·학습용)</td><td>300건</td><td>csv · 48KB</td><td>질문·제보 분류, 자동 응답</td></tr>{d.imported && <tr><td>춘향전 (가져온 소설)</td><td>이용자 등록 · {d.chunhyangKind}</td><td>1편 · 4화</td><td>txt · 286KB</td><td>세계관·인물 추출</td></tr>}</tbody></table></div>
  </>
}

/** 목업 adminLegacy() tab=rights: A03·A04·A06 */
function Rights({ d, vm, sel, setSel }: BodyProps) {
  const f = d.admin.flagged
  const selWork = d.works.find((w) => w.id === sel)
  return <>
    <div className="panel" style={{ marginTop: 22 }}><b>권리 확인·신고</b> <span className="muted small">행을 누르면 상세가 열려요</span><table style={{ marginTop: 10 }}><tbody><tr><th>소설</th><th>올린 사람</th><th>종류</th><th>권리 확인</th><th>포크</th><th>신고</th><th>상태</th></tr>
      {d.rights.map((r) => <tr key={r.id} className={`click ${sel === r.id ? 'sel' : ''}`} onClick={() => setSel(r.id)}><td>{r.title}</td><td>{r.owner}</td><td>{r.kind}</td><td><span className={`chip ${r.rights === '확인됨' ? 'ok' : 'wait'}`}>{r.rights}</span></td><td>{r.fork}</td><td>{r.reports}</td><td>{r.state}</td></tr>)}</tbody></table></div>
    {sel === 'flag1' ? <div className="panel" style={{ marginTop: 14 }} id="a04"><b>신고 상세 · {f.title}</b><dl className="ai"><dt>신고 사유</dt><dd>원작 무단 사용 의심 (외부 IP)</dd><dt>신고 수</dt><dd>{f.reports}건</dd><dt>권리 확인</dt><dd>{f.rights}</dd><dt>현재 조치</dt><dd>{f.state} · 포크 {f.fork}</dd></dl>
      <div className="rowend"><button type="button" className="btn" onClick={() => vm.flag('proof')}>증빙 요청</button><button type="button" className="btn" onClick={() => vm.flag('hide')}>비공개 전환</button><button type="button" className="btn pri" onClick={() => vm.flag('lift')}>소명 확인 · 제한 해제</button></div>{f.log.length > 0 && <div className="note" style={{ marginTop: 10 }}>{f.log.map((x, i) => <div key={i}>{x}</div>)}</div>}<p className="small muted" style={{ marginTop: 10 }}>기획서 V-2: 적법한 중단 요청·침해 정황 시 공개·AI·포크 기능 제한, 소명·재개 절차 제공</p></div>
      : selWork && (() => { const qs = d.queue.filter((q) => q.w === sel); return <div className="panel" style={{ marginTop: 14 }} id="a04"><b>신고 상세 · {selWork.title}</b><p className="small muted" style={{ margin: '6px 0 10px' }}>권리 {selWork.rights} · 종류 {selWork.kind} · 신고 {qs.length}건</p>
        {qs.length ? qs.map((q) => <div className="rp" key={q.id}><div className="top"><b>{q.n ? `${q.n}화` : '소설 전체'} · {q.type}</b><span className={`chip ${q.status === '접수' ? 'wait' : 'ok'}`}>{q.status}</span></div><q className="cq">{q.quote || '문장 인용 없이 소설 전체를 신고했어요.'}</q><div className="small">{q.text} · {q.who}</div>{q.appeal && <p>소명: {q.appeal}</p>}
          {q.status === '접수' ? <div className="rowend" style={{ marginTop: 8 }}><button type="button" className="btn sm" onClick={() => vm.review(q.id, 'ok')}>문제 없음</button><button type="button" className="btn sm pri" onClick={() => vm.review(q.id, 'hide')}>비공개 조치</button></div>
            : q.status === '소명 제출' && <div className="rowend"><button type="button" className="btn sm" onClick={() => vm.review(q.id, 'keep')}>비공개 유지</button><button type="button" className="btn sm pri" onClick={() => vm.review(q.id, 'restore')}>소명 인정 · 복원</button></div>}</div>) : <p className="small muted">접수된 신고가 없어요.</p>}</div> })()}
    <h3 className="st">A06 · 원작 / 포크 데이터 격리 점검</h3><div className="panel"><table><tbody><tr><th>포크</th><th>원작 · 분기</th><th>스냅샷 해시</th><th>원작 현재 해시 (1~분기 회차)</th><th>인물 상태 차이</th><th>판정</th></tr>
      {d.isolation.map((x) => <tr key={x.title}><td>{x.title}</td><td>{x.parent} · {x.forkAt}화</td><td className="mono">{x.snapNow}</td><td className="mono">{x.now}</td><td>{x.diff.length ? x.diff.join(', ') : '없음'}</td><td><span className={`chip ${x.ok ? 'ok' : 'wait'}`}>{x.ok ? (x.same ? '격리 · 동일' : '격리 · 원작만 변경됨') : '스냅샷 변경!'}</span></td></tr>)}</tbody></table><p className="small muted" style={{ marginTop: 10 }}>스냅샷 해시는 포크 생성 순간의 원작 회차를 복사한 값이에요. 원작이 PR로 수정되면 오른쪽 해시만 바뀌고 포크 쪽은 그대로여야 정상이에요.</p></div>
  </>
}

/** 목업 adminLegacy() 그 밖의 tab(llm): A05 */
function Llm({ d, vm }: { d: Data; vm: VM }) {
  return <>
    <div className="panel"><h2>처리 실패·지연 경고</h2><p className="small muted">데모 오류만 표시하며 자동 재처리하지 않아요.</p>{d.alerts.length ? d.alerts.map((a) => <div className="rp" key={a.id}><b>{a.task} · {a.status}</b><p>{a.detail}</p><dl className="ai"><dt>실패 단계</dt><dd>{a.stage || '미정'}</dd><dt>오류</dt><dd>{a.error || a.detail}</dd><dt>다음 조치</dt><dd>{a.action || '수동 확인'}</dd></dl>{a.resolved ? <span className="chip">조치 기록됨</span> : <button type="button" className="btn sm" onClick={() => vm.resolveAlert(a.id)}>확인 및 조치 기록</button>}</div>) : <p className="muted">경고가 없어요.</p>}
      <p className="small muted">작업·상태·실패 단계·오류·다음 조치만 표시해요. 개인 원고 내용은 로그에 넣지 않아요.</p><Go to="/admin?tab=rights" className="btn sm">권리 신고 대기 확인</Go></div>
    <div className="panel" style={{ marginTop: 22 }}><b>LLM Ops · 운영 지표</b> <span className="demo">시연 데이터 · 실시간 연결 없음</span><table style={{ marginTop: 10 }}><thead><tr><th>지표</th><th>측정 내용</th><th>현재 값</th><th>집계 기준</th></tr></thead><tbody>
      {[['실패·시간 초과율', '작업 단계별 요청 결과', '단계별'], ['응답 지연', '처리 단계별 지연 시간', '모델·프롬프트 버전'], ['토큰·비용', '지급 주체별 사용량', '원고 내용 미수집'], ['제안 채택·수정 승인', '제안 반영 여부', '품질 지표'], ['오류 검증·필터 복구', '오류 적용·숨김 복구 비율', '품질 지표']].map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b}</td><td>미정</td><td>{c}</td></tr>)}</tbody></table>
      <p className="small muted" style={{ marginTop: 10 }}>MVP에서는 Langfuse 추적만 제공해요. 추적에는 요청·작업·단계·모델·프롬프트 버전·토큰·지연·결과를 기록하며 개인 원고 내용은 넣지 않아요. 평가 세트와 정보 누설 표본 검사는 MVP 이후예요. 이 데모는 실시간 연결이 없어요.</p></div>
  </>
}

/** 목업 #adminCharacterChatForm */
function ChatForm({ d, vm }: { d: Data; vm: VM }) {
  const [form, setForm] = useState({ kind: 'fork', workId: '', character: '' })
  const available = vm.chatChoices(d.works, form.kind)
  const sw = available.find((x) => x.w.id === form.workId) ?? available[0]
  const cast = sw?.cast ?? []
  const character = cast.some((c) => c.n === form.character) ? form.character : cast[0]?.n ?? ''
  return (
    <form className="panel" onSubmit={async (e) => { e.preventDefault(); if (sw && await vm.addChat(sw.w.id, character)) setForm({ kind: sw.w.parent ? 'fork' : 'original', workId: sw.w.id, character }) }}><b>캐릭터챗 추가</b>
      <div className="form-grid" style={{ marginTop: 12 }}><label className="field">작품 유형<select className="inp" value={form.kind} onChange={(e) => setForm({ kind: e.target.value, workId: '', character: '' })}><option value="all">전체</option><option value="original">원작</option><option value="fork">포크</option></select></label>
        <label className="field">작품<select className="inp" value={sw?.w.id ?? ''} disabled={!available.length} onChange={(e) => setForm({ ...form, workId: e.target.value, character: '' })}>{available.map(({ w }) => <option key={w.id} value={w.id}>{w.title}{w.parent ? ' · 포크' : ' · 원작'}</option>)}</select></label>
        <label className="field wide">캐릭터<select className="inp" value={character} disabled={!cast.length} onChange={(e) => setForm({ ...form, workId: sw?.w.id ?? '', character: e.target.value })}>{cast.map((c) => <option key={c.n} value={c.n}>{c.n} · {c.d}</option>)}</select></label></div>
      <div className="rowend"><button className="btn pri" type="submit" disabled={!sw || !character}>캐릭터챗 추가</button></div><p className="admin-note">공개 작품의 기존 캐릭터만 선택할 수 있어요. 추가·운영 상태는 이 브라우저의 데모 화면에만 반영됩니다.</p></form>
  )
}

/** 목업 adminExtra() tab=feedback: 문의 답변(data-inquiry-form)과 작가 검토 제보 */
function Feedback({ d, vm }: { d: Data; vm: VM }) {
  return <>
    <div className="panel"><div className="table-head"><b>사용자 문의</b><span className="demo">현재 브라우저 데모</span></div>{d.inquiries.length ? d.inquiries.map((q) => (
      <article className="inquiry-item" key={q.id}><b>[{q.t}] {q.s}</b><p className="small muted">{q.d} · {q.st}</p><p>{q.b}</p>{q.reply ? <p className="inquiry-reply"><b>운영팀 답변</b><br />{q.reply}</p>
        : <form onSubmit={(e) => { e.preventDefault(); vm.reply(q.id, val(e, 'answer')) }}><label className="field">답변<textarea className="ta" name="answer" maxLength={1000} required /></label><div className="rowend"><button className="btn pri sm" type="submit">답변 등록</button></div></form>}</article>
    )) : <p className="muted">아직 접수된 문의가 없어요. 사용자가 문의를 보내면 이곳에서 답변할 수 있어요.</p>}</div>
    <div className="panel" style={{ marginTop: 14 }}><b>작가 검토 제보</b><p className="small muted">원고 반영은 작가가 검토합니다.</p><table style={{ marginTop: 10 }}><thead><tr><th>유형</th><th>내용</th><th>접수일</th><th>상태</th></tr></thead><tbody>{d.reports.length ? d.reports.map((r) => (
      <tr key={r.id}><td>{r.type || '제보'}</td><td><b>{r.text}</b>{r.reply && <><br /><span className="small muted">{r.reply}</span></>}</td><td>—</td><td>{r.status}</td></tr>
    )) : <tr><td colSpan={4} className="muted">접수된 제보가 없어요.</td></tr>}</tbody></table><p className="admin-note">답변과 상태는 현재 브라우저에만 반영되며 실제 전송되지 않습니다.</p></div>
  </>
}

/** 목업 #adminAccountForm: A17 */
function Admins({ d, vm }: { d: Data; vm: VM }) {
  return <>
    <form className="panel" onSubmit={async (e) => { e.preventDefault(); const form = e.currentTarget; const perms = [...form.querySelectorAll<HTMLInputElement>('[name=adminPermission]:checked')].map((x) => x.value); if (await vm.addAdmin(val(e, 'name'), val(e, 'email'), perms)) form.reset() }}><b>관리자 계정 생성</b>
      <div className="form-grid" style={{ marginTop: 12 }}><label className="field">이름<input className="inp" name="name" maxLength={20} required /></label><label className="field">이메일<input className="inp" name="email" type="email" maxLength={100} required /></label></div>
      <fieldset className="admin-permissions" style={{ marginTop: 12 }}><legend>부여할 권한</legend><div className="admin-perm-grid">{ADMIN_PERMISSIONS.map(([k, l]) => <label key={k}><input type="checkbox" name="adminPermission" value={k} />{l}</label>)}</div></fieldset>
      <div className="rowend"><button className="btn pri" type="submit">관리자 계정 추가</button></div><p className="admin-note">현재 화면은 오프라인 데모입니다. 계정 생성·로그인·권한 검사는 서버 연결이 필요합니다.</p></form>
    <div className="panel" style={{ marginTop: 14 }}><div className="table-head"><b>관리자 계정</b><span className="demo">현재 브라우저의 시연 데이터</span></div><table><thead><tr><th>이름</th><th>이메일</th><th>권한</th><th>등록일</th></tr></thead><tbody>{d.admin.admins.map((a) => (
      <tr key={a.id}><td><b>{a.nick}</b></td><td>{a.email}</td><td>{ADMIN_PERMISSIONS.filter(([k]) => a.permissions.includes(k)).map(([, l]) => l).join(', ') || '없음'}</td><td>{a.created}</td></tr>
    ))}</tbody></table></div>
  </>
}

/** 목업 #adminProfileForm: A15 */
function Profile({ d, vm }: { d: Data; vm: VM }) {
  const p = d.admin.profile
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); vm.saveProfile(val(e, 'nick'), val(e, 'email')) }}><div className="mehead"><span className="meav big">{p.nick.slice(0, 1)}</span><div><b>{p.nick}</b><small>관리자 계정 · 가입일 {p.joined}</small></div></div>
      <div className="form-grid" style={{ marginTop: 14 }}><label className="field">닉네임<input className="inp" name="nick" defaultValue={p.nick} maxLength={12} required /></label><label className="field">이메일<input className="inp" name="email" type="email" defaultValue={p.email} required /></label></div>
      <div className="rowend"><button className="btn pri" type="submit">프로필 저장</button></div><p className="admin-note">저장한 값은 이 브라우저의 데모 상태에만 반영됩니다. 비밀번호 변경과 인증 설정은 실제 계정 서비스 연결 후 제공해야 합니다.</p></form>
  )
}

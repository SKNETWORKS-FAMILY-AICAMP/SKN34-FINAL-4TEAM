import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'

import { ADMIN_PERMISSIONS, type AdminTab, adminTab } from '../../../../domain/entities/admin'
import { ACTIVITY_FORBIDDEN, activityActionLabel, activityActor, activityDetail, activityTarget } from '../../../../domain/entities/adminActivity'
import { REPORT_STATUSES, reportKindLabel, reportStatusLabel } from '../../../../domain/entities/report'
import { toKoreanDateTimeInput } from '../../../../domain/entities/operations'
import { commentWorkOptions, filterOperationsComments } from '../../../../domain/entities/operationsComment'
import type { OperationsWork } from '../../../../domain/entities/operationsWork'
import { SUPPORT_STATUSES, supportStatusLabel, type SupportReply } from '../../../../domain/entities/supportInquiry'
import { ofKind } from '../../../../domain/entities/work'
import { kstDateTime, kstPeriod } from '../../../shared/format'
import { EventStatusChip } from '../../../shared/EventStatusChip'
import { Go } from '../../../shared/Go'
import { ReportHistoryList } from '../../../shared/reports/ReportHistoryList'
import { Footer } from '../../../shared/shell/Gnb'
import { ThemeButton } from '../../../shared/shell/ThemeButton'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import type { AdminFilter as Filter } from '../state/adminViewSlice'
import { LIVE_TABS, useAdminViewModel, useForkIntegrity } from '../viewmodel/useAdminViewModel'
import { AdminActionStatus, OperationsNotices } from './OperationsPanels'
import { useAdminDetailFocus } from './useAdminDetailFocus'

type VM = ReturnType<typeof useAdminViewModel>
type Data = NonNullable<VM['data']>

/** 운영 업무 대상별 메뉴: 회원 → 콘텐츠 → 소통 → 서비스 → 내 계정 */
const GROUPS: [string, [AdminTab, string][]][] = [
  ['현황', [['data', '개요']]],
  ['회원 관리', [['users', '사용자'], ['admins', '관리자 계정·권한']]],
  ['콘텐츠 관리', [['works', '작품'], ['rights', '신고·권리'], ['comments', '댓글'], ['characterChats', '캐릭터챗']]],
  ['소통 관리', [['feedback', '제보·문의'], ['notices', '공지'], ['events', '이벤트']]],
  ['서비스 운영', [['llm', 'LLM Ops'], ['jobs', '정기 작업'], ['credits', '크레딧'], ['audit', '활동 로그']]],
  ['내 계정', [['profile', '프로필']]],
]
const TITLES: Record<AdminTab, [string, string]> = {
  data: ['관리 개요', '수집 자료와 서비스 상태를 확인합니다.'],
  rights: ['신고·권리 관리', '운영 신고를 검토하고 대상 작품 제한·권리 증빙 요청을 기록합니다.'],
  llm: ['LLM Ops', 'LLM 운영 지표는 시연용 예시이며 실시간 연결은 없습니다.'],
  admins: ['관리자 계정과 권한', '업무별 접근 권한을 나누어 관리자 계정을 추가합니다.'],
  users: ['사용자 관리', '회원 목록을 조회하고 이용 제한·해제를 요청합니다.'],
  works: ['작품 관리', '작품의 공개 상태와 이용 권리를 조회하고 운영 제한·해제를 요청합니다.'],
  characterChats: [
    '캐릭터챗 관리',
    '공개 작품의 원작·포크와 캐릭터를 선택해 챗을 추가하거나 운영 상태를 바꿉니다.',
  ],
  comments: ['댓글 관리', '독자 댓글을 조회하고 숨김·게시 복구를 요청합니다.'],
  feedback: [
    '제보·문의',
    '회원이 보낸 고객지원 문의를 확인하고 답변합니다. 작가 검토 제보는 시연용 데이터예요.',
  ],
  jobs: ['정기 작업', '서버가 주기적으로 실행할 작업과 최근 결과를 확인합니다.'],
  events: ['이벤트 관리', '이벤트 내용과 기간을 관리합니다.'],
  notices: ['공지 게시', '공지를 작성하고 수정·삭제합니다.'],
  credits: ['크레딧 관리', '크레딧 이용 현황과 정책 확정 상태를 확인합니다.'],
  audit: ['관리자 활동 로그', '관리자가 수행한 변경 조치를 최신순으로 보여 줍니다.'],
  profile: ['관리자 프로필', '로그인한 관리자 계정 정보를 확인합니다.'],
}
const KINDS: [string, string][] = [['all', '전체'], ['original', '원작'], ['fork', '포크']]
/** 작품 탭의 권리 표시값. 검색도 화면에 보이는 이 문구로 합니다. */
const rightsLabel = (w: OperationsWork) =>
  `${w.creationType === 'external_derivative' ? '외부 2차 창작' : '원작'} · ${w.rightsConfirmed ? '권리 확인됨' : '권리 미확인'}`
const has = (q: string, ...xs: string[]) =>
  !q || xs.join(' ').toLocaleLowerCase().includes(q.toLocaleLowerCase())
const blocked = (vm: VM, key: string) => vm.mutationsBlocked || !!vm.actions[key]?.pending
/** 폼 안에 상태를 그리는 조치(공지·이벤트·문의 답변·신고 처리)의 키. 그 밖의 키는 표의 행 조치라 화면 위에서 안내합니다. */
const IN_FORM = /^(notice:|event:|inquiry:|report:)/
/** 행 조치 키(`member:<id>` 등)의 대상을 화면에 보이는 이름으로 바꿉니다. 목록에서 찾지 못하면 이름 없이 안내합니다. */
function actionTarget(vm: VM, key: string): string | undefined {
  const [kind, id] = key.split(':')
  const live = vm.live.data
  if (kind === 'member') { const m = live?.members.find((x) => x.id === id); return m && `${m.nickname} 님` }
  if (kind === 'work') { const w = live?.works.find((x) => x.workId === id); return w && `「${w.title}」` }
  if (kind === 'comment') { const c = live?.comments.find((x) => x.commentId === id); return c && `${c.authorName} 님의 댓글` }
  if (kind === 'chat') { const c = vm.data?.chats.find((x) => x.id === id); return c ? `${c.w.title} · ${c.character}` : id === 'new' ? '캐릭터챗 추가' : undefined }
  if (kind === 'job') return vm.data?.admin.jobs.find((x) => x.id === id)?.name
  if (kind === 'alert') return vm.data?.alerts.find((x) => x.id === id)?.task
  return kind === 'admin' ? '관리자 계정 생성' : undefined
}
/**
 * 이 키의 조치 상태가 지금 화면의 폼 안에 그려지는지. 그려지면 완료 문구가 폼 안에 보이므로 화면 위 완료 줄에 같은 문구를 또 두지 않습니다.
 * 새로 저장해 상세로 넘어가거나 삭제해 폼이 사라진 조치는 폼 안에 남지 않으므로 화면 위 완료 줄이 맡습니다.
 */
function shownInForm(vm: VM, tab: AdminTab, key: string) {
  const [kind, id, , replyId] = key.split(':')
  // 공지·이벤트 폼은 새로 쓰는 중이거나 고른 항목이 목록에 있을 때만 그려집니다.
  const open = (selection: string | null, rows: { id: string }[] = []) => id === selection && (id === 'new' || rows.some((row) => row.id === id))
  if (kind === 'notice') return tab === 'notices' && open(vm.recordSelection.notices, vm.live.data?.notices)
  if (kind === 'event') return tab === 'events' && open(vm.recordSelection.events, vm.live.data?.events)
  // 문의 답변·신고 처리 폼은 고른 항목의 상세를 읽은 뒤에만 그려지고, 답변 수정 폼은 그 답변이 남아 있을 때만 있습니다.
  const inquiry = vm.live.inquiry.data
  if (kind === 'inquiry') return tab === 'feedback' && id === vm.recordSelection.inquiries && inquiry?.id === id && (!replyId || inquiry.replies.some((reply) => reply.id === replyId))
  return kind === 'report' && tab === 'rights' && id === vm.sel && vm.live.report.data?.id === id
}
/** 폼 입력값을 이름으로 읽습니다 (목업 $('#id').value). */
const val = (e: FormEvent<HTMLFormElement>, name: string) =>
  String(new FormData(e.currentTarget).get(name) ?? '')

/** 표마다 용도를 알리는 캡션과, 좁은 화면에서 키보드로 가로 스크롤할 수 있는 영역을 붙입니다. */
function Table(
  { label, style, children }: { label: string; style?: CSSProperties; children: ReactNode },
) {
  return (
    <div className='adm-scroll' role='region' tabIndex={0} aria-label={label} style={style}>
      <table>
        <caption className='sr-only'>{label}</caption>
        {children}
      </table>
    </div>
  )
}

/** 목업 admin(): 자체 상단바·업무 메뉴. 데모 화면 가림일 뿐이며 실제 권한 검사는 Core가 맡아야 합니다. */
export function AdminPage() {
  const [q] = useSearchParams()
  const tab = adminTab(q.get('tab'))
  const vm = useAdminViewModel(tab)
  const { sel, filters, setSel } = vm
  const f = filters[tab] ??
    {
      category: 'all',
      sort: tab === 'users' ? 'newest' : tab === 'comments' ? 'likes' : 'title',
      query: '',
      search: '',
    }
  const setF = (x: Partial<Filter>) => vm.setFilter(tab, { ...f, ...x })
  const d = vm.data
  const [title, desc] = TITLES[tab]
  const live = LIVE_TABS.includes(tab)
  useDocumentTitle(`관리자 · ${title}`)
  const nav = useRef<HTMLElement>(null)
  // 모바일 가로 메뉴나 높이를 넘겨 스스로 스크롤되는 세로 메뉴에서 현재 탭이 메뉴 밖에 있으면 보이게 합니다.
  useEffect(() => {
    // scrollIntoView는 키보드 Tab 시작점까지 옮기므로 메뉴의 스크롤 값만 바꿉니다.
    const n = nav.current
    const a = n?.querySelector('[aria-current="page"]')
    if (!n || !a) return
    const at = a.getBoundingClientRect()
    const box = n.getBoundingClientRect()
    if (n.scrollWidth > n.clientWidth) n.scrollLeft += at.left - box.left - 16
    if (n.scrollHeight > n.clientHeight) n.scrollTop += at.top - box.top - 16
  }, [tab])
  const content = useRef<HTMLElement>(null)
  const successTarget = IN_FORM.test(vm.lastSuccessKey) ? undefined : actionTarget(vm, vm.lastSuccessKey)
  return (
    <>
    <div className='adm'>
      <a
        className='skip-link'
        href='#admin-content'
        onClick={(e) => {
          e.preventDefault()
          content.current?.focus()
        }}
      >
        본문으로 바로가기
      </a>
      <div className='top'>
        <div className='wrap in'>
          <b style={{ fontSize: 16 }}>STORYFORK 관리자</b>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--fixed-sub)' }}>
            {vm.me.nick} 님으로 로그인
          </span>
          <ThemeButton className='btn sm adm-theme' />
        </div>
      </div>
      <main id='main' tabIndex={-1} className='wrap'>
        <div className='shell'>
          <nav ref={nav} className='admin-nav' aria-label='관리자 업무'>
            {/* 메뉴 묶음 이름은 본문 제목(h1)보다 앞에 오므로 제목으로 읽히지 않게 하고, 묶음 이름은 group의 레이블로 전합니다. */}
            {GROUPS.map(([g, items]) => (
              <section key={g} role='group' aria-label={g}>
                <h2 role='presentation'>{g}</h2>
                {items.map(([k, l]) => (
                  <Go
                    key={k}
                    to={`/admin?tab=${k}`}
                    className={tab === k ? 'on' : ''}
                    aria-current={tab === k ? 'page' : undefined}
                  >
                    {l}
                    {LIVE_TABS.includes(k) && <span className='nav-live' aria-hidden='true'>API</span>}
                  </Go>
                ))}
              </section>
            ))}
            <p className='nav-legend'><span className='nav-live'>API</span> 실제 운영 데이터를 다루는 탭</p>
            <button type='button' onClick={vm.logout}>로그아웃</button>
          </nav>
          <section ref={content} id='admin-content' tabIndex={-1} className='workspace'>
            <header className='admin-head'>
              <div>
                <h1>{title}</h1>
                <p>{desc}</p>
              </div>
              <span className={`chip ${live ? 'ok' : 'wait'}`}>
                {live ? '운영 API 연결' : '데모 화면'}
              </span>
            </header>
            {!live && vm.isLoading && (
              <p className='admin-data-state' role='status'>관리자 데이터를 불러오고 있어요.</p>
            )}
            {/* 완료 안내는 한 곳에만: 폼 안에 그려지는 조치가 아니면 이 줄이 대상 이름과 함께 맡습니다. */}
            {vm.lastSuccess && !shownInForm(vm, tab, vm.lastSuccessKey) && (
              <p className='admin-data-state' role='status'>
                {successTarget && <b>{successTarget} · </b>}{vm.lastSuccess}
              </p>
            )}
            {!live && vm.isRefreshing && (
              <p className='admin-data-state' role='status'>
                목록을 새로고침하고 있어요. 이전 조회 내용은 유지하며 처리 버튼은 잠시 사용할 수 없어요.
              </p>
            )}
            {!live && vm.isError && (
              <div className='admin-data-state admin-action-error' role='alert'>
                <p>
                  {d
                    ? vm.lastSuccess
                      ? '마지막 요청은 성공했지만 목록 새로고침에 실패했어요. 아래는 이전 조회 내용이에요. 같은 요청을 다시 보내지 말고 먼저 목록을 새로고침해 주세요.'
                      : '목록 새로고침에 실패했어요. 아래는 이전 조회 내용이에요. 다시 불러온 뒤 처리해 주세요.'
                    : '관리자 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'}
                </p>
                <button type='button' className='btn sm' onClick={vm.retry}>다시 불러오기</button>
              </div>
            )}
            {d && !vm.isError && (
              <div className='rowend admin-refresh'>
                <button
                  type='button'
                  className='btn sm'
                  onClick={vm.retry}
                  disabled={vm.isRefreshing}
                >
                  목록 새로고침
                </button>
              </div>
            )}
            {/* 행 조치의 진행·실패는 버튼에서 떨어진 여기에 보이므로 대상 이름을 붙입니다. 완료는 위의 완료 줄이 맡습니다. */}
            {Object.entries(vm.actions)
              .filter(([key]) => !IN_FORM.test(key))
              .map(([key, state]) => <AdminActionStatus key={key} state={state} target={actionTarget(vm, key)} done={false} />)}
            {(d || live) && (
              <Body key={tab} tab={tab} d={d} vm={vm} f={f} setF={setF} sel={sel} setSel={setSel} />
            )}
          </section>
        </div>
      </main>
    </div>
    <Footer />
    </>
  )
}

type BodyProps = {
  tab: AdminTab
  /** 데모 조회 결과. 운영 API 탭(users·admins·works·comments·rights·profile)은 이 값 없이도 그립니다. */
  d: Data | undefined
  vm: VM
  f: Filter
  setF: (x: Partial<Filter>) => void
  sel: string | null
  setSel: (s: string) => void
}

/** 목업 adminExtra()의 controls(): 분류·정렬과 (작품·댓글·캐릭터챗) 검색 */
function Controls(
  { tab, f, setF, categories, sorts }: Pick<BodyProps, 'tab' | 'f' | 'setF'> & {
    categories: [string, string][]
    sorts: [string, string][]
  },
) {
  const label = tab === 'works' ? '작품 검색' : tab === 'comments' ? '댓글 검색' : '캐릭터챗 검색'
  return (
    <>
      <div className='table-head'>
        <label className='field'>
          분류<select
            className='inp'
            value={f.category}
            onChange={(e) => setF({ category: e.target.value })}
          >
            {categories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className='field'>
          정렬<select
            className='inp'
            value={f.sort}
            onChange={(e) => setF({ sort: e.target.value })}
          >
            {sorts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      {['works', 'comments', 'characterChats'].includes(tab) && (
        <form
          className='admin-search'
          onSubmit={(e) => {
            e.preventDefault()
            setF({ query: val(e, 'query').trim() })
          }}
        >
          <label className='field'>
            {label}
            <input
              className='inp'
              name='query'
              defaultValue={f.query}
              placeholder={tab === 'works'
                ? '작품명·작성자·권리 유형'
                : tab === 'comments'
                ? '댓글 내용·작품명·작성자'
                : '작품명·캐릭터'}
            />
          </label>
          <button className='btn sm pri' type='submit'>검색</button>
        </form>
      )}
    </>
  )
}

function Body(p: BodyProps) {
  const { tab, d, vm, f } = p
  if (tab === 'rights') return <Rights {...p} />
  if (tab === 'admins') return <Admins vm={vm} />
  if (tab === 'users') return <Users {...p} />
  if (tab === 'profile') return <Profile vm={vm} />
  if (tab === 'works') return <Works {...p} />
  if (tab === 'comments') return <Comments {...p} />
  if (tab === 'audit') return <Audit vm={vm} />
  if (!d) return null
  const titleSort = (
    a: string,
    b: string,
  ) => (f.sort === 'titleDesc' ? b.localeCompare(a, 'ko') : a.localeCompare(b, 'ko'))
  let T: ReactNode
  if (tab === 'data') T = <Overview d={d} vm={vm} />
  else if (tab === 'llm') T = <Llm d={d} vm={vm} />
  else if (tab === 'characterChats') {
    const list = d.chats.filter((c) =>
      ofKind(f.category, c.w) && has(f.query, c.w.title, c.character)
    ).sort((a, b) =>
      titleSort(a.w.title, b.w.title) || a.character.localeCompare(b.character, 'ko')
    )
    T = (
      <>
        <ChatForm d={d} vm={vm} />
        <div className='panel' style={{ marginTop: 14 }}>
          <div className='table-head'>
            <h2 className='panel-title'>캐릭터챗 목록</h2>
            <span className='demo'>작품·캐릭터 연결</span>
          </div>
          <Controls
            {...p}
            categories={KINDS}
            sorts={[['title', '작품 제목순'], ['titleDesc', '작품 제목 역순']]}
          />
          <Table label='캐릭터챗 운영 표' style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th scope='col'>구분</th>
                <th scope='col'>작품</th>
                <th scope='col'>캐릭터</th>
                <th scope='col'>상태</th>
                <th scope='col' className='act'>관리</th>
              </tr>
            </thead>
            <tbody>
              {list.length
                ? list.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className={`chip ${c.w.parent ? 'if' : 'ok'}`}>
                        {c.w.parent ? '포크' : '원작'}
                      </span>
                    </td>
                    <td>
                      <b>{c.w.title}</b>
                    </td>
                    <td>{c.character}</td>
                    <td>
                      <span className={`chip ${c.enabled === false ? 'wait' : 'ok'}`}>
                        {c.enabled === false ? '중지' : '운영 중'}
                      </span>
                    </td>
                    <td>
                      <button
                        type='button'
                        className='btn sm'
                        aria-label={`${c.w.title} ${c.character} ${c.enabled === false ? '운영 재개' : '중지'}`}
                        disabled={blocked(vm, `chat:${c.id}`)}
                        onClick={() => vm.toggleChat(c.id)}
                      >
                        {c.enabled === false ? '운영 재개' : '중지'}
                      </button>
                    </td>
                  </tr>
                ))
                : (
                  <tr>
                    <td colSpan={5} className='muted'>조건에 맞는 캐릭터챗이 없어요.</td>
                  </tr>
                )}
            </tbody>
          </Table>
        </div>
      </>
    )
  } else if (tab === 'feedback') T = <Feedback {...p} />
  else if (tab === 'jobs') {
    T = (
      <div className='panel'>
        <div className='table-head'>
          <h2 className='panel-title'>운영 정기 작업</h2>
          <span className='demo'>데모 기록 · 실제 실행 없음</span>
        </div>
        <p className='admin-note'>
          실행 주기는 아직 정하지 않았어요. 사용자가 요청한 AI 작업은 자동으로 다시 실행하지 않아요.
        </p>
        <Table label='정기 작업 표'>
          <thead>
            <tr>
              <th scope='col'>작업</th>
              <th scope='col'>실행 주기</th>
              <th scope='col'>최근 상태</th>
              <th scope='col'>최근 결과</th>
              <th scope='col' className='act'>조치</th>
            </tr>
          </thead>
          <tbody>
            {d.admin.jobs.map((j) => (
              <tr key={j.id}>
                <td>
                  <b>{j.name}</b>
                </td>
                <td>미정</td>
                <td>
                  <span className={`chip ${j.status === '실패' ? 'wait' : 'ok'}`}>{j.status}</span>
                </td>
                <td>{j.last}</td>
                <td>
                  {j.status === '실패'
                    ? (
                      <button
                        type='button'
                        className='btn sm'
                        aria-label={`${j.name} 수동 재시도 시연`}
                        disabled={blocked(vm, `job:${j.id}`)}
                        onClick={() => vm.runJob(j.id)}
                      >
                        수동 재시도 시연
                      </button>
                    )
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className='admin-note'>
          실패한 작업만 수동으로 다시 시도할 수 있어요. 이 화면의 버튼은 실제 작업을 실행하지 않아요.
        </p>
      </div>
    )
  } else if (tab === 'events') {
    T = <Events vm={vm} />
  } else if (tab === 'notices') {
    T = (
      <>
        <LiveState vm={vm} label='공지 목록' />
        <OperationsNotices vm={vm} />
      </>
    )
  } else if (tab === 'credits') {
    T = (
      <div className='panel'>
        <div className='table-head'>
          <h2 className='panel-title'>크레딧 원장</h2>
          <span className='chip wait'>정책 미확정</span>
        </div>
        <p>현재 실제 잔액·충전·차감 내역은 연결되어 있지 않습니다.</p>
        <Table label='크레딧 원장 표' style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th scope='col'>일시</th>
              <th scope='col'>계정</th>
              <th scope='col'>유형</th>
              <th scope='col'>변동</th>
              <th scope='col'>상태</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className='muted' style={{ textAlign: 'center', padding: 24 }}>
                표시할 실제 내역이 없어요.
              </td>
            </tr>
          </tbody>
        </Table>
        <p className='admin-note'>
          충전·회수·수동 조정은 정책, 권한, 복구 기준이 확정된 뒤 연결해야 합니다. 이 화면에서는
          크레딧을 변경하지 않습니다.
        </p>
      </div>
    )
  }
  return T
}

/** 목업 adminLegacy() tab=data: A01+A02 */
function Overview({ d, vm }: { d: Data; vm: VM }) {
  const reports = vm.live.data?.reports
  const waiting = vm.live.inquiries
  // 서버 목록이 최신 100개까지라 100개 이상이면 정확한 수를 알 수 없어 100+로 표기합니다.
  const waitingCount = waiting.data ? (waiting.data.length >= 100 ? '100+' : waiting.data.length) : '—'
  return (
    <>
      <div className='admin-priorities'>
        <div>
          <h2>확인할 작업</h2>
          <p>신고와 문의 수는 운영 서버 기준이에요.</p>
        </div>
        <div className='priority-links'>
          <Go to='/admin?tab=feedback'>
            <b>{waitingCount}</b>
            <span>{waiting.isError ? '답변 대기 문의 · 불러오지 못함' : '답변 대기 문의'}</span>
          </Go>
          <Go to='/admin?tab=rights'>
            <b>{reports ? reports.length : '—'}</b>
            <span>{vm.live.isError ? '접수된 신고 · 불러오지 못함' : '접수된 신고'}</span>
          </Go>
        </div>
      </div>
      <h2 className='admin-section-title'>데이터 시연 현황</h2>
      <div className='kpi'>
        <div>
          <small>수집 원작 (만료·등록)</small>
          <b>{d.expired.length}편</b>
          <span className='small muted'>{d.expired.map((w) => w.title).join(', ')}</span>
        </div>
        <div>
          <small>가상 독자 댓글</small>
          <b>300건</b>
          <span className='small muted'>유형 라벨 포함 · LLM 생성 (데모)</span>
        </div>
        <div>
          <small>전처리 결과 JSON</small>
          <b>{d.chunhyang ? 2 : 1}개</b>
          <span className='small muted'>구운몽{d.chunhyang ? ' + 가져온 소설' : ''}</span>
        </div>
        <div>
          <small>처리 대기 제보</small>
          <b>{d.pending}건</b>
          <span className='small muted'>수정 제안 + 작가 확인 필요</span>
        </div>
      </div>
      <div className='panel' style={{ marginTop: 14 }}>
        <h2 className='panel-title'>전처리 6단계 · 구운몽 시연 흐름</h2>
        <div className='flow' style={{ marginTop: 12 }}>
          {[
            ['수집', '원문 txt'],
            ['정제', '특수·불용 문자 제거'],
            ['회차 분할', '16장 → 4화'],
            ['LLM 추출', '인물·관계·세계관·사건'],
            ['검수', '작가·관리자 확인'],
            ['결과', 'JSON 목업'],
          ].map(([a, b], i) => (
            <div key={a} className={i < 4 || d.chunhyang ? 'done' : ''}>
              <b>{i + 1}. {a}</b>
              {b}
            </div>
          ))}
        </div>
        <p className='small' style={{ marginTop: 10, color: 'var(--pri-ink)' }}>
          실제 LLM 호출은 연결되지 않았으며, 이 파이프라인은 목표 흐름을 보여 주는 시연용입니다.
        </p>
      </div>
      <div className='panel' style={{ marginTop: 14 }}>
        <h2 className='panel-title'>수집 데이터 명세</h2>
        <Table label='수집 데이터 명세 표' style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th scope='col'>데이터</th>
              <th scope='col'>출처</th>
              <th scope='col'>양</th>
              <th scope='col'>형식</th>
              <th scope='col'>쓰는 곳</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>구운몽 전문</td>
              <td>공유마당 만료 저작물</td>
              <td>1편 · 16장</td>
              <td>txt · 412KB</td>
              <td>세계관·인물 추출, 읽기 화면</td>
            </tr>
            <tr>
              <td>가상 독자 댓글</td>
              <td>LLM 생성 (비상업·학습용)</td>
              <td>300건</td>
              <td>csv · 48KB</td>
              <td>질문·제보 분류, 자동 응답</td>
            </tr>
            {!!d.chunhyang && (
              <tr>
                <td>춘향전 (가져온 소설)</td>
                <td>이용자 등록 · {d.chunhyang.kind}</td>
                <td>1편 · 4화</td>
                <td>txt · 286KB</td>
                <td>세계관·인물 추출</td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>
    </>
  )
}

/** 실제 운영 API 목록의 로딩·새로고침·실패. 실패를 빈 목록으로 숨기지 않습니다. */
function LiveState({ vm, label, state }: { vm: VM; label: string; state?: Pick<VM['live'], 'isLoading' | 'isRefreshing' | 'isError' | 'retry'> }) {
  const l = state ?? vm.live
  return (
    <>
      {l.isLoading && <p className='admin-data-state' role='status'>{label}을 불러오고 있어요.</p>}
      {l.isRefreshing && <p className='admin-data-state' role='status'>{label}을 새로고침하고 있어요.</p>}
      {l.isError && (
        <div className='admin-data-state admin-action-error' role='alert'>
          <p>{label}을 불러오지 못했어요. 로그인·업무 권한과 서버 연결을 확인한 뒤 다시 시도해 주세요.</p>
          <button type='button' className='btn sm' onClick={l.retry}>다시 불러오기</button>
        </div>
      )}
    </>
  )
}

/** 72 관리자 활동 기록: 운영 서비스가 남긴 관리자 변경 조치 최신 100개. 수행자 닉네임은 서버가 채우며 없으면 ID를 보여 줍니다. */
function Audit({ vm }: { vm: VM }) {
  // null은 조회 권한(관리자 계정 관리)이 없다는 뜻입니다. 실패가 아니라서 다시 불러오기 없이 권한 안내만 보입니다.
  const activities = vm.live.data?.activities
  const rows = activities ?? []
  return (
    <div className='panel admin-operations'>
      <LiveState vm={vm} label='활동 기록' />
      {activities === null && <p className='admin-action-error' role='alert'>{ACTIVITY_FORBIDDEN}</p>}
      {vm.live.data && activities !== null && (
        <ul className='audit-list'>
          {rows.length
            ? rows.map((x) => {
              const detail = activityDetail(x)
              return (
                <li key={x.id}>
                  <time dateTime={x.createdAt}>{kstDateTime(x.createdAt)}</time>
                  <div>
                    <b>{activityActionLabel(x.action)}</b>
                    <div className='small muted'>수행자 {activityActor(x)} · 대상 {activityTarget(x)}</div>
                    {detail && <div className='small'>{detail}</div>}
                  </div>
                </li>
              )
            })
            : <li className='muted'>아직 기록된 조치가 없어요.</li>}
        </ul>
      )}
      <p className='admin-note'>
        최신 100건까지 보여 줘요. 회원·관리자 계정·신고·작품·공지·이벤트·문의 답변의 변경 조치가 성공하면 운영 서버에 남고,
        조회나 실패한 요청은 기록하지 않아요. 활동 로그는 ‘관리자 계정 관리’ 권한이 있는 관리자만 볼 수 있어요.
      </p>
    </div>
  )
}

/** 74 운영 작품 조회·조치: Content의 전체 작품(공개·비공개·운영 제한)과 운영 제한·해제. 분류·검색·정렬은 받은 목록에서 이 화면이 계산합니다. */
function Works(p: BodyProps) {
  const { vm, f } = p
  const integrity = useForkIntegrity()
  // 점검 결과를 열면 결과 제목으로, 닫으면 누른 점검 버튼으로 포커스를 옮깁니다(목록 크기는 보지 않아 검색 중 포커스를 뺏지 않습니다).
  const root = useAdminDetailFocus(integrity.target?.id ?? null)
  const check = integrity.report.data
  const rows = (vm.live.data?.works ?? [])
    .filter((w) => (f.category === 'all' || w.originKind === f.category) && has(f.query, w.title, w.authorName, rightsLabel(w)))
    .sort((a, b) => (f.sort === 'titleDesc' ? b.title.localeCompare(a.title, 'ko') : a.title.localeCompare(b.title, 'ko')))
  return (
    <section className='panel' ref={root}>
      <Controls {...p} categories={KINDS} sorts={[['title', '제목순'], ['titleDesc', '제목 역순']]} />
      <LiveState vm={vm} label='작품 목록' />
      {vm.live.data && (
        <Table label='작품 관리 표' style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th scope='col'>작품</th>
              <th scope='col'>작성자</th>
              <th scope='col'>종류</th>
              <th scope='col'>권리</th>
              <th scope='col'>공개 상태</th>
              <th scope='col' className='act'>조치</th>
            </tr>
          </thead>
          <tbody>
            {rows.length
              ? rows.map((w) => (
                <tr key={w.workId} className={integrity.target?.id === w.workId ? 'sel' : undefined}>
                  <td>
                    <b>{w.title}</b>
                  </td>
                  <td>{w.authorName}</td>
                  <td>{w.originKind === 'fork' ? '포크' : '원작'}</td>
                  <td>{rightsLabel(w)}</td>
                  <td>
                    <span className={`chip ${w.restricted ? 'wait' : 'ok'}`}>
                      {w.restricted ? '운영 제한' : w.visibility === 'public' ? '공개' : '비공개'}
                    </span>
                  </td>
                  <td>
                    <div className='rowend'>
                      <button
                        type='button'
                        className='btn sm'
                        aria-label={`「${w.title}」 ${w.restricted ? '제한 해제' : '운영 제한'}`}
                        disabled={blocked(vm, `work:${w.workId}`)}
                        onClick={() => {
                          if (w.restricted || window.confirm(`「${w.title}」을 제한할까요? 해제 전까지 독자에게 보이지 않아요.`)) {
                            void vm.live.setWorkRestriction(w.workId, !w.restricted)
                          }
                        }}
                      >
                        {w.restricted ? '제한 해제' : '운영 제한'}
                      </button>
                      {w.originKind === 'fork' && (
                        <button
                          type='button'
                          className='btn sm'
                          data-record-id={w.workId}
                          aria-label={`「${w.title}」 포크 정합성 점검`}
                          onClick={() => integrity.select({ id: w.workId, title: w.title })}
                        >
                          포크 정합성 점검
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
              : (
                <tr>
                  <td colSpan={6} className='muted'>검색 결과가 없어요.</td>
                </tr>
              )}
          </tbody>
        </Table>
      )}
      {integrity.target && (
        <section className='panel admin-operations' aria-label='포크 정합성 점검 결과'>
          <h2 tabIndex={-1}>{integrity.target.title} 정합성 점검</h2>
          <button type='button' className='btn sm' onClick={() => integrity.select(null)}>점검 결과 닫기</button>
          {integrity.report.isLoading && <p role='status'>고정 기준 기록을 확인하고 있어요…</p>}
          {integrity.report.isError && (
            <p role='alert' className='admin-action-error'>
              점검 결과를 불러오지 못했어요. <button type='button' className='btn sm' onClick={integrity.report.retry}>다시 시도</button>
            </p>
          )}
          {/* 서버가 점검할 수 없다고 안내한 포크(404·409)는 다시 시도해도 같아서 그 문구만 보이고 다시 시도 버튼은 두지 않습니다. */}
          {check && !check.available && <p role='alert' className='admin-action-error'>{check.message}</p>}
          {check?.available && (
            <dl className='ai'>
              <dt>기준 회차</dt><dd>{check.report.basisEpisode}화</dd>
              <dt>원고 비교</dt>
              <dd><span className={`chip ${check.report.matches ? 'ok' : 'wait'}`}>{check.report.matches ? '일치' : '불일치'}</span></dd>
              <dt>포크 스냅샷 해시</dt><dd><code>{check.report.forkHash}</code></dd>
              <dt>원작 고정 기록 해시</dt><dd><code>{check.report.sourceHash}</code></dd>
              <dt>인물 상태</dt><dd>비교 불가 · 기준 회차의 인물 상태 기록이 없어요.</dd>
            </dl>
          )}
        </section>
      )}
      <p className='admin-note'>
        운영 제한한 작품은 공개 작품 목록·상세·회차 열람에서 보이지 않아요. 제한을 해제하면 작가가 정한 공개 상태로 돌아가요.
        이 조치는 신고 사건에는 남기지 않고 활동 로그에만 기록해요.
      </p>
    </section>
  )
}

/** 75 운영 댓글 조회·조치: Content의 삭제되지 않은 전체 댓글(공개·숨김)과 운영 숨김·게시 복구. 작품 분류·검색·정렬은 받은 목록에서 이 화면이 계산합니다. */
function Comments(p: BodyProps) {
  const { vm, f } = p
  const all = vm.live.data?.comments ?? []
  const rows = filterOperationsComments(all, { workId: f.category, query: f.query, sort: f.sort })
  return (
    <div className='panel'>
      <Controls
        {...p}
        categories={[['all', '전체 작품'], ...commentWorkOptions(all)]}
        sorts={[['likes', '공감 많은순'], ['likesAsc', '공감 적은순']]}
      />
      <LiveState vm={vm} label='댓글 목록' />
      {vm.live.data && (
        <Table label='댓글 관리 표' style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th scope='col'>댓글</th>
              <th scope='col'>작품</th>
              <th scope='col'>작성자</th>
              <th scope='col'>공감</th>
              <th scope='col'>상태</th>
              <th scope='col'>작성일</th>
              <th scope='col' className='act'>조치</th>
            </tr>
          </thead>
          <tbody>
            {rows.length
              ? rows.map((c) => (
                <tr key={c.commentId}>
                  <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.body}</td>
                  <td>{`${c.workTitle} · ${c.episodeNumber}화`}</td>
                  <td>{c.authorName}</td>
                  <td>{c.likeCount}</td>
                  <td>
                    <span className={`chip ${c.hidden ? 'wait' : 'ok'}`}>{c.hidden ? '숨김' : '게시'}</span>
                  </td>
                  <td>{kstDateTime(c.createdAt)}</td>
                  <td>
                    <button
                      type='button'
                      className='btn sm'
                      aria-label={`${c.authorName} 댓글 ${c.hidden ? '게시 복구' : '숨김'}`}
                      disabled={blocked(vm, `comment:${c.commentId}`)}
                      onClick={() => {
                        if (c.hidden || window.confirm(`「${c.workTitle}」의 댓글을 숨길까요? 독자에게는 자리표시로만 보여요.`)) {
                          void vm.live.setCommentHidden(c.commentId, !c.hidden)
                        }
                      }}
                    >
                      {c.hidden ? '게시 복구' : '숨김'}
                    </button>
                  </td>
                </tr>
              ))
              : (
                <tr>
                  <td colSpan={7} className='muted'>검색 결과가 없어요.</td>
                </tr>
              )}
          </tbody>
        </Table>
      )}
      <p className='admin-note'>
        숨긴 댓글은 독자에게 원문 대신 ‘운영 정책으로 숨겨진 댓글입니다.’로 보이고 수정·좋아요가 막혀요. 삭제가 아니라서 게시 복구하면
        되돌아오고, 작성자는 자기 댓글을 삭제할 수 있어요. 숨김·게시 복구는 활동 로그에 기록되고, 신고 사건은 만들지 않아요.
      </p>
    </div>
  )
}

/** 73 운영 회원 조회·조치: Core 회원 목록과 이용 제한·해제 */
function Users({ vm, f, setF }: BodyProps) {
  const rows = vm.live.data?.members ?? []
  return (
    <div className='panel'>
      <div className='table-head'>
        <label className='field'>
          역할<select className='inp' value={f.category} onChange={(e) => setF({ category: e.target.value })}>
            <option value='all'>전체</option>
            <option value='MEMBER'>회원</option>
            <option value='ADMIN'>관리자</option>
          </select>
        </label>
        <label className='field'>
          정렬<select className='inp' value={f.sort} onChange={(e) => setF({ sort: e.target.value })}>
            <option value='newest'>가입 최신순</option>
            <option value='oldest'>가입 오래된순</option>
          </select>
        </label>
      </div>
      <form
        className='admin-search'
        onSubmit={(e) => {
          e.preventDefault()
          setF({ query: val(e, 'query').trim() })
        }}
      >
        <label className='field'>
          사용자 검색<input className='inp' name='query' type='search' defaultValue={f.query} placeholder='이름·이메일' />
        </label>
        <button className='btn sm pri' type='submit'>검색</button>
      </form>
      <LiveState vm={vm} label='회원 목록' />
      {vm.live.data && (rows.length
        ? (
          <Table label='사용자 계정 표'>
            <thead>
              <tr>
                <th scope='col'>사용자</th>
                <th scope='col'>역할</th>
                <th scope='col'>가입일</th>
                <th scope='col'>상태</th>
                <th scope='col' className='act'>조치</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.nickname}</b>
                    <br />
                    <span className='small muted'>{u.email}</span>
                  </td>
                  <td>{u.role === 'ADMIN' ? '관리자' : '회원'}</td>
                  <td>{kstDateTime(u.createdAt)}</td>
                  <td>
                    <span className={`chip ${u.restricted ? 'wait' : 'ok'}`}>{u.restricted ? '이용 제한' : '이용 가능'}</span>
                  </td>
                  <td>
                    {u.id === vm.selfId
                      ? <span className='small muted'>본인 계정</span>
                      : (
                        <button
                          type='button'
                          className='btn sm'
                          aria-label={`${u.nickname} ${u.restricted ? '제한 해제' : '이용 제한'}`}
                          disabled={blocked(vm, `member:${u.id}`)}
                          onClick={() => {
                            if (u.restricted || window.confirm(`${u.nickname} 님의 로그인을 막을까요? 제한 해제 전까지 로그인할 수 없어요.`)) {
                              void vm.live.setMemberRestriction(u.id, !u.restricted)
                            }
                          }}
                        >
                          {u.restricted ? '제한 해제' : '이용 제한'}
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
        : <p className='admin-empty'>조건에 맞는 회원이 없어요.</p>)}
      <p className='admin-note'>
        제한된 회원은 바로 로그인할 수 없어요. 이미 발급된 로그인은 만료될 때까지 남을 수 있어요.
      </p>
    </div>
  )
}

/** 34 신고·소명·조치: 운영 신고 목록·상세·이력과 검토·작품 제한·권리 증빙 요청 */
function Rights({ d, vm, f, setF, sel, setSel }: BodyProps) {
  const rows = vm.live.data?.reports ?? []
  const detail = vm.live.report
  const r = detail.data?.id === sel ? detail.data : null
  const key = `report:${sel}`
  // 같은 신고의 조치는 서로 기다리게 해 상태가 엇갈리지 않게 합니다.
  const busy = vm.mutationsBlocked || ['review', 'restrict', 'evidence'].some((k) => vm.actions[`${key}:${k}`]?.pending)
  const heading = useRef<HTMLHeadingElement>(null)
  // 상세가 목록 아래에 열리므로 선택한 신고의 상세 제목으로 이동합니다.
  // r 객체는 새로고침마다 바뀌므로 신고 ID가 바뀔 때만 이동합니다.
  const shown = r?.id
  useEffect(() => {
    if (!shown) return
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'center' })
  }, [shown])
  return (
    <>
      <div className='panel' style={{ marginTop: 22 }}>
        <div className='table-head'>
          <h2 className='panel-title'>운영 신고</h2>
          <label className='field'>
            상태<select className='inp' value={f.category} onChange={(e) => setF({ category: e.target.value })}>
              <option value='all'>전체</option>
              {REPORT_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <LiveState vm={vm} label='신고 목록' />
        {vm.live.data && (rows.length
          ? (
            <Table label='운영 신고 표' style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th scope='col'>작품</th>
                  <th scope='col'>종류</th>
                  <th scope='col'>사유</th>
                  <th scope='col'>상태</th>
                  <th scope='col'>작품 제한</th>
                  <th scope='col'>접수</th>
                  <th scope='col' className='act'>처리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id} className={`click ${sel === x.id ? 'sel' : ''}`} onClick={() => setSel(x.id)}>
                    <td>
                      <b>{x.workTitle}</b>
                    </td>
                    <td>{reportKindLabel(x.kind)}</td>
                    <td>{x.reason}</td>
                    <td>
                      <span className={`chip ${x.status === 'RECEIVED' ? 'wait' : 'ok'}`}>{reportStatusLabel(x.status)}</span>
                    </td>
                    <td>{x.contentRestricted ? '제한 중' : '공개 유지'}</td>
                    <td>{kstDateTime(x.createdAt)}</td>
                    <td>
                      <button
                        type='button'
                        className={`btn sm ${sel === x.id ? 'pri' : ''}`}
                        aria-pressed={sel === x.id}
                        aria-label={`${x.workTitle} 신고 검토`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSel(x.id)
                        }}
                      >
                        {sel === x.id ? '검토 중' : '검토'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
          : <p className='admin-empty'>조건에 맞는 신고가 없어요.</p>)}
      </div>
      {sel && (
        <div className='panel admin-operations' style={{ marginTop: 14 }} id='a04'>
          {detail.isError && (
            <div className='admin-action-error' role='alert'>
              <p>신고 상세를 불러오지 못했어요. 목록을 새로고침한 뒤 다시 선택해 주세요.</p>
              <button type='button' className='btn sm' onClick={detail.retry}>다시 불러오기</button>
            </div>
          )}
          {!r && !detail.isError && <p role='status'>신고 상세를 불러오고 있어요.</p>}
          {r && (
            <>
              <h2 ref={heading} tabIndex={-1} className='admin-section-title'>신고 상세 · {r.workTitle}</h2>
              <dl className='ai'>
                <dt>종류</dt>
                <dd>{reportKindLabel(r.kind)}</dd>
                <dt>상태</dt>
                <dd>
                  <div className='report-state'>
                    <span>{reportStatusLabel(r.status)} · 작품 {r.contentRestricted ? '제한 중' : '공개 유지'}</span>
                    <button
                      type='button'
                      className='btn sm'
                      disabled={busy}
                      onClick={() => {
                        if (r.contentRestricted || window.confirm(`「${r.workTitle}」을 제한할까요? 해제 전까지 독자에게 보이지 않아요.`)) {
                          void vm.live.setContentRestriction(r.id, !r.contentRestricted)
                        }
                      }}
                    >
                      {r.contentRestricted ? '작품 제한 해제' : '작품 제한'}
                    </button>
                  </div>
                  <AdminActionStatus state={vm.actions[`${key}:restrict`]} />
                </dd>
                <dt>신고 사유</dt>
                <dd className='admin-prose'>{r.reason}</dd>
                <dt>증거</dt>
                <dd className='admin-prose'>{r.evidence || '없음'}</dd>
                <dt>접수 · 갱신</dt>
                <dd>{kstDateTime(r.createdAt)} · {kstDateTime(r.updatedAt)}</dd>
              </dl>
              <h3>처리 이력</h3>
              <ReportHistoryList history={r.history ?? []} />
              <div className='report-actions'>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const form = e.currentTarget
                    const decision = val(e, 'decision') === 'REJECTED' ? 'REJECTED' : 'ACCEPTED'
                    if (await vm.live.review(r.id, decision, val(e, 'note'))) form.reset()
                  }}
                >
                  <h3>검토 결과 기록</h3>
                  <fieldset disabled={busy}>
                    <p className='small muted'>모든 항목은 필수예요.</p>
                    <label className='field'>
                      결과<select className='inp' name='decision' defaultValue='' required>
                        <option value='' disabled>선택해 주세요</option>
                        <option value='ACCEPTED'>신고 인정</option>
                        <option value='REJECTED'>기각</option>
                      </select>
                    </label>
                    <label className='field'>
                      검토 메모<textarea className='ta' name='note' required maxLength={2000} rows={3} />
                    </label>
                    <div className='rowend'>
                      <button type='submit' className='btn pri'>검토 결과 저장</button>
                    </div>
                  </fieldset>
                  <AdminActionStatus state={vm.actions[`${key}:review`]} />
                </form>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const form = e.currentTarget
                    if (await vm.live.requestEvidence(r.id, val(e, 'body'))) form.reset()
                  }}
                >
                  <h3>권리 증빙 요청</h3>
                  <fieldset disabled={busy}>
                    <label className='field'>
                      작품 등록자에게 보낼 요청<textarea className='ta' name='body' required maxLength={5000} rows={3} placeholder='예: 원작 이용 허락서나 계약서를 보내 주세요.' />
                    </label>
                    <div className='rowend'>
                      <button type='submit' className='btn'>증빙 요청 보내기</button>
                    </div>
                  </fieldset>
                  <AdminActionStatus state={vm.actions[`${key}:evidence`]} />
                </form>
              </div>
            </>
          )}
        </div>
      )}
      {d && (
        <details className='panel admin-legacy-demo' style={{ marginTop: 14 }}>
          <summary>원작·포크 데이터 격리 점검 (예시 데이터)</summary>
          <Table label='원작·포크 격리 점검 표'>
            <thead>
              <tr>
                <th scope='col'>포크</th>
                <th scope='col'>원작 · 분기</th>
                <th scope='col'>스냅샷 해시</th>
                <th scope='col'>원작 현재 해시 (1~분기 회차)</th>
                <th scope='col'>인물 상태 차이</th>
                <th scope='col'>판정</th>
              </tr>
            </thead>
            <tbody>
              {d.isolation.map((x) => (
                <tr key={x.title}>
                  <td>{x.title}</td>
                  <td>{x.parent} · {x.forkAt}화</td>
                  <td className='mono'>{x.snapNow}</td>
                  <td className='mono'>{x.now}</td>
                  <td>{x.diff.length ? x.diff.join(', ') : '없음'}</td>
                  <td>
                    <span className={`chip ${x.ok ? 'ok' : 'wait'}`}>
                      {x.ok ? (x.same ? '격리 · 동일' : '격리 · 원작만 변경됨') : '스냅샷 변경!'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className='small muted' style={{ marginTop: 10 }}>
            스냅샷 해시는 포크 생성 순간의 원작 회차를 복사한 값이에요. 원작이 수정되면 오른쪽 해시만 바뀌고 포크 쪽은 그대로여야 정상이에요.
          </p>
        </details>
      )}
    </>
  )
}

/** 목업 adminLegacy() 그 밖의 tab(llm): A05 */
function Llm({ d, vm }: { d: Data; vm: VM }) {
  return (
    <>
      <div className='panel'>
        <h2>처리 실패·지연 경고</h2>
        <p className='small muted'>데모 오류만 표시하며 자동 재처리하지 않아요.</p>
        {d.alerts.length
          ? d.alerts.map((a) => (
            <div className='rp' key={a.id}>
              <b>{a.task} · {a.status}</b>
              <p>{a.detail}</p>
              <dl className='ai'>
                <dt>실패 단계</dt>
                <dd>{a.stage || '미정'}</dd>
                <dt>오류</dt>
                <dd>{a.error || a.detail}</dd>
                <dt>다음 조치</dt>
                <dd>{a.action || '수동 확인'}</dd>
              </dl>
              {a.resolved
                ? <span className='chip'>조치 기록됨</span>
                : (
                  <button
                    type='button'
                    className='btn sm'
                    aria-label={`${a.task} 확인 및 조치 기록`}
                    disabled={blocked(vm, `alert:${a.id}`)}
                    onClick={() => vm.resolveAlert(a.id)}
                  >
                    확인 및 조치 기록
                  </button>
                )}
            </div>
          ))
          : <p className='muted'>경고가 없어요.</p>}
        <p className='small muted'>
          작업·상태·실패 단계·오류·다음 조치만 표시해요. 개인 원고 내용은 로그에 넣지 않아요.
        </p>
      </div>
      <div className='panel' style={{ marginTop: 22 }}>
        <h2 className='panel-title'>LLM Ops · 운영 지표</h2> <span className='demo'>시연 데이터 · 실시간 연결 없음</span>
        <Table label='LLM 운영 지표 표' style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th scope='col'>지표</th>
              <th scope='col'>측정 내용</th>
              <th scope='col'>현재 값</th>
              <th scope='col'>집계 기준</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['실패·시간 초과율', '작업 단계별 요청 결과', '단계별'],
              ['응답 지연', '처리 단계별 지연 시간', '모델·프롬프트 버전'],
              ['토큰·비용', '지급 주체별 사용량', '원고 내용 미수집'],
              ['제안 채택·수정 승인', '제안 반영 여부', '품질 지표'],
              ['오류 검증·필터 복구', '오류 적용·숨김 복구 비율', '품질 지표'],
            ].map(([a, b, c]) => (
              <tr key={a}>
                <td>{a}</td>
                <td>{b}</td>
                <td>미정</td>
                <td>{c}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className='small muted' style={{ marginTop: 10 }}>
          현재는 요청 추적만 제공해요. 요청·작업·단계·모델·프롬프트 버전·토큰·지연·결과를 기록하고 개인 원고 내용은 넣지 않아요.
        </p>
      </div>
    </>
  )
}

/** 목업 #adminCharacterChatForm */
function ChatForm({ d, vm }: { d: Data; vm: VM }) {
  const { chatForm: form, setChatForm: setForm } = vm
  const available = vm.chatChoices(d.works, form.kind)
  const sw = available.find((x) => x.w.id === form.workId) ?? available[0]
  const cast = sw?.cast ?? []
  const character = cast.some((c) => c.n === form.character) ? form.character : cast[0]?.n ?? ''
  return (
    <form
      className='panel'
      onSubmit={async (e) => {
        e.preventDefault()
        if (sw && await vm.addChat(sw.w.id, character)) {
          setForm({
            kind: sw.w.parent ? 'fork' : 'original',
            workId: sw.w.id,
            character,
          })
        }
      }}
    >
      <h2 className='panel-title'>캐릭터챗 추가</h2>
      <div className='form-grid' style={{ marginTop: 12 }}>
        <label className='field'>
          작품 유형<select
            className='inp'
            value={form.kind}
            onChange={(e) => setForm({ kind: e.target.value, workId: '', character: '' })}
          >
            <option value='all'>전체</option>
            <option value='original'>원작</option>
            <option value='fork'>포크</option>
          </select>
        </label>
        <label className='field'>
          작품<select
            className='inp'
            value={sw?.w.id ?? ''}
            disabled={!available.length}
            onChange={(e) => setForm({ ...form, workId: e.target.value, character: '' })}
          >
            {available.map(({ w }) => (
              <option key={w.id} value={w.id}>{w.title}{w.parent ? ' · 포크' : ' · 원작'}</option>
            ))}
          </select>
        </label>
        <label className='field wide'>
          캐릭터<select
            className='inp'
            value={character}
            disabled={!cast.length}
            onChange={(e) =>
              setForm({ ...form, workId: sw?.w.id ?? '', character: e.target.value })}
          >
            {cast.map((c) => <option key={c.n} value={c.n}>{c.n} · {c.d}</option>)}
          </select>
        </label>
      </div>
      <div className='rowend'>
        <button
          className='btn pri'
          type='submit'
          disabled={!sw || !character || blocked(vm, 'chat:new')}
        >
          {vm.actions['chat:new']?.pending ? '추가 중…' : '캐릭터챗 추가'}
        </button>
      </div>
      <p className='admin-note'>
        공개 작품의 기존 캐릭터만 선택할 수 있어요. 추가·운영 상태는 이 브라우저의 데모 화면에만
        반영됩니다.
      </p>
    </form>
  )
}

/** 69 이벤트 안내·운영: 운영 API의 이벤트 목록·상세·등록·전체 수정·삭제. 진행 상태는 기간으로 계산해 보여 줍니다. */
function Events({ vm }: { vm: VM }) {
  const selection = vm.recordSelection.events
  const rows = vm.live.data?.events ?? []
  const row = rows.find((item) => item.id === selection)
  const root = useAdminDetailFocus(selection, !!row, rows.length)
  const key = selection ?? 'new'
  const form = vm.eventDrafts[key] ?? {
    title: row?.title ?? '',
    body: row?.body ?? '',
    startsAt: toKoreanDateTimeInput(row?.startsAt ?? null),
    endsAt: toKoreanDateTimeInput(row?.endsAt ?? null),
  }
  const state = vm.actions[`event:${key}`]
  const busy = vm.mutationsBlocked || !!state?.pending
  const loading = vm.live.isLoading || vm.live.isRefreshing
  return (
    <section className='panel admin-operations' aria-label='운영 이벤트' ref={root}>
      {!selection
        ? (
          <>
            <div className='table-head'>
              <h2 tabIndex={-1}>운영 이벤트 목록</h2>
              <button type='button' className='btn pri' data-record-id='new' onClick={() => vm.selectRecord('events', 'new')}>
                이벤트 작성
              </button>
            </div>
            <LiveState vm={vm} label='이벤트 목록' />
            {vm.live.data && (rows.length
              ? (
                <ul className='admin-record-list'>
                  {rows.map((item) => (
                    <li key={item.id}>
                      <button
                        type='button'
                        className='admin-record-link'
                        data-record-id={item.id}
                        onClick={() => vm.selectRecord('events', item.id)}
                      >
                        <b>{item.title}</b>
                        <span className='small muted'>
                          <EventStatusChip status={vm.eventStatusNow(item)} /> {kstPeriod(item)}
                          {vm.eventDrafts[item.id] ? ' · 수정 초안 있음' : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
              : <p className='admin-empty'>등록된 운영 이벤트가 없어요. 이벤트를 작성해 보세요.</p>)}
          </>
        )
        : (
          <>
            <button type='button' className='btn sm' onClick={() => vm.selectRecord('events', null)}>이벤트 목록으로</button>
            <h2 tabIndex={-1}>{selection === 'new' ? '새 운영 이벤트' : row?.title ?? '이벤트 확인'}</h2>
            <LiveState vm={vm} label='이벤트 목록' />
            {selection !== 'new' && !row
              ? (!loading && !vm.live.isError && (
                <p role='alert'>이벤트를 표시할 수 없어요. 목록 새로고침 후 다시 선택해 주세요.</p>
              ))
              : (
                <>
                  {row && (
                    <>
                      <p className='small muted'><EventStatusChip status={vm.eventStatusNow(row)} /> {kstPeriod(row)}</p>
                      <p className='small muted'>UTC: {row.startsAt ?? '시작 미정'} / {row.endsAt ?? '종료 미정'}</p>
                      <p className='small muted'>등록 {kstDateTime(row.createdAt)} · 수정 {kstDateTime(row.updatedAt)}</p>
                      <p className='admin-prose'>{row.body}</p>
                      <h3>이벤트 수정</h3>
                    </>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void vm.saveEvent(row?.id ?? null, form)
                    }}
                  >
                    <fieldset disabled={busy} className='form-grid'>
                      <p className='small muted wide'>제목과 내용은 필수예요.</p>
                      <label className='field wide'>
                        이벤트 제목<input
                          className='inp'
                          required
                          maxLength={200}
                          value={form.title}
                          onChange={(e) => vm.setEventDraft(key, { ...form, title: e.target.value })}
                        />
                      </label>
                      <label className='field wide'>
                        이벤트 내용<textarea
                          className='ta'
                          required
                          maxLength={20000}
                          rows={8}
                          value={form.body}
                          onChange={(e) => vm.setEventDraft(key, { ...form, body: e.target.value })}
                        />
                      </label>
                      <label className='field'>
                        시작 (한국시간)<input
                          className='inp'
                          type='datetime-local'
                          step={60}
                          value={form.startsAt}
                          aria-describedby='event-time-help'
                          onChange={(e) => vm.setEventDraft(key, { ...form, startsAt: e.target.value })}
                        />
                      </label>
                      <label className='field'>
                        종료 (한국시간)<input
                          className='inp'
                          type='datetime-local'
                          step={60}
                          value={form.endsAt}
                          aria-describedby='event-time-help'
                          onChange={(e) => vm.setEventDraft(key, { ...form, endsAt: e.target.value })}
                        />
                      </label>
                      <p id='event-time-help' className='small muted wide'>
                        두 기간은 선택 사항이에요. 한국시간(UTC+09:00)으로 입력하면 UTC로 저장해요. 비우면 해당 기간은 미정이며, 종료는
                        시작보다 빠를 수 없어요.
                      </p>
                      <div className='rowend wide'>
                        <button type='submit' className='btn pri'>{state?.pending ? '저장 중…' : '이벤트 저장'}</button>
                        {row && (
                          <button
                            type='button'
                            className='btn'
                            onClick={() => {
                              if (window.confirm('이 이벤트를 삭제할까요? 공개 목록에서도 바로 사라지고 복구할 수 없어요.')) void vm.deleteEvent(row.id)
                            }}
                          >
                            이벤트 삭제
                          </button>
                        )}
                      </div>
                    </fieldset>
                    <AdminActionStatus state={state} />
                  </form>
                </>
              )}
          </>
        )}
      <p className='admin-note'>
        진행 상태(상시·예정·진행 중·종료)는 시작·종료 시각으로 정해져요. 이벤트를 끝내려면 종료 시각을 수정해 주세요. 등록하면 바로
        공개되고 알림은 보내지 않아요. 참여·보상은 지원하지 않아요.
      </p>
    </section>
  )
}

/** 67 고객지원 문의: 회원이 보낸 문의 목록·상세와 답변 등록·수정·삭제. 작가 검토 제보는 기존 데모를 그대로 둡니다. */
function Feedback({ d, vm, f, setF }: BodyProps) {
  const selection = vm.recordSelection.inquiries
  const list = vm.live.inquiries
  const rows = list.data ?? []
  const detail = vm.live.inquiry
  const row = detail.data?.id === selection ? detail.data : null
  const root = useAdminDetailFocus(selection, !!row, rows.length)
  const replyHeading = useRef<HTMLHeadingElement>(null)
  const adding = vm.actions[`inquiry:${selection}:reply`]
  return (
    <>
      <section className='panel admin-operations' aria-label='회원 고객지원 문의' ref={root}>
        {!selection
          ? (
            <>
              <div className='table-head'>
                <h2 tabIndex={-1}>회원 문의</h2>
                <label className='field'>
                  상태<select className='inp' value={f.category} onChange={(e) => setF({ category: e.target.value })}>
                    <option value='all'>전체</option>
                    {SUPPORT_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
              <LiveState vm={vm} state={list} label='회원 문의 목록' />
              {list.data && (rows.length
                ? (
                  <ul className='admin-record-list'>
                    {rows.map((x) => (
                      <li key={x.id}>
                        <button
                          type='button'
                          className='admin-record-link'
                          data-record-id={x.id}
                          onClick={() => vm.selectRecord('inquiries', x.id)}
                        >
                          <b>[{x.category}] {x.title}</b>
                          <span className='small muted'>
                            {supportStatusLabel(x.status)} · 답변 {x.replies.length}개 · {kstDateTime(x.createdAt)} · 회원 {x.memberId.slice(0, 8)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
                : <p className='admin-empty'>조건에 맞는 문의가 없어요.</p>)}
            </>
          )
          : (
            <>
              <button type='button' className='btn sm' onClick={() => vm.selectRecord('inquiries', null)}>
                문의 목록으로
              </button>
              <h2 tabIndex={-1}>{row ? row.title : '문의 상세'}</h2>
              {detail.isError && (
                <div className='admin-action-error' role='alert'>
                  <p>문의 상세를 불러오지 못했어요. 로그인·업무 권한과 서버 연결을 확인한 뒤 다시 시도해 주세요.</p>
                  <button type='button' className='btn sm' onClick={detail.retry}>다시 불러오기</button>
                </div>
              )}
              {!row && !detail.isError && <p role='status'>문의 상세를 불러오고 있어요.</p>}
              {row && (
                <>
                  <dl className='ai'>
                    <dt>분류</dt>
                    <dd>{row.category}</dd>
                    <dt>상태</dt>
                    <dd>
                      <span className={`chip ${row.status === 'ANSWERED' ? 'ok' : 'wait'}`}>{supportStatusLabel(row.status)}</span>
                    </dd>
                    <dt>접수</dt>
                    <dd>{kstDateTime(row.createdAt)}</dd>
                    <dt>회원</dt>
                    <dd>{row.memberId.slice(0, 8)}</dd>
                  </dl>
                  <p className='admin-prose'>{row.body}</p>
                  <section className='admin-replies' aria-label='문의 답변'>
                    <h3 tabIndex={-1} ref={replyHeading}>답변 {row.replies.length}개</h3>
                    {row.replies.length
                      ? row.replies.map((reply, i) => (
                        <ReplyEditor
                          key={reply.id}
                          inquiryId={row.id}
                          reply={reply}
                          index={i}
                          vm={vm}
                          onDeleted={() => replyHeading.current?.focus()}
                        />
                      ))
                      : <p className='muted'>아직 등록된 답변이 없어요.</p>}
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault()
                        const form = e.currentTarget
                        if (await vm.live.addReply(row.id, val(e, 'body'))) form.reset()
                      }}
                    >
                      <h3>새 답변</h3>
                      <fieldset disabled={vm.mutationsBlocked || !!adding?.pending}>
                        <label className='field'>
                          새 답변 내용<textarea className='ta' name='body' required maxLength={20000} rows={5} />
                        </label>
                        <div className='rowend'>
                          <button type='submit' className='btn pri'>{adding?.pending ? '등록 중…' : '답변 등록'}</button>
                        </div>
                      </fieldset>
                      <AdminActionStatus state={adding} />
                    </form>
                    <p className='admin-note'>답변을 등록해도 회원에게 알림은 가지 않아요. 회원은 내 문의에서 확인해요.</p>
                  </section>
                </>
              )}
            </>
          )}
      </section>
      {d && (
        <div className='panel' style={{ marginTop: 14 }}>
          <h2 className='panel-title'>작가 검토 제보</h2>
          <p className='small muted'>
            원고 반영은 작가가 검토합니다. 위 회원 문의와는 별도의 시연용 제보예요.
          </p>
          <Table label='작가 검토 제보 표' style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th scope='col'>유형</th>
                <th scope='col'>내용</th>
                <th scope='col'>접수일</th>
                <th scope='col'>상태</th>
              </tr>
            </thead>
            <tbody>
              {d.reports.length
                ? d.reports.map((r) => (
                  <tr key={r.id}>
                    <td>{r.type || '제보'}</td>
                    <td>
                      <b>{r.text}</b>
                      {r.reply && (
                        <>
                          <br />
                          <span className='small muted'>{r.reply}</span>
                        </>
                      )}
                    </td>
                    <td>—</td>
                    <td>{r.status}</td>
                  </tr>
                ))
                : (
                  <tr>
                    <td colSpan={4} className='muted'>접수된 제보가 없어요.</td>
                  </tr>
                )}
            </tbody>
          </Table>
          <p className='admin-note'>
            답변과 상태는 현재 브라우저에만 반영되며 실제 전송되지 않습니다.
          </p>
        </div>
      )}
    </>
  )
}

/** 한 답변의 수정·삭제. 수정 입력은 저장에 성공해 서버 시각이 바뀔 때까지 실패해도 그대로 둡니다. */
function ReplyEditor(
  { inquiryId, reply, index, vm, onDeleted }: {
    inquiryId: string
    reply: SupportReply
    index: number
    vm: VM
    onDeleted: () => void
  },
) {
  const state = vm.actions[`inquiry:${inquiryId}:reply:${reply.id}`]
  return (
    <article className='inquiry-item' aria-label={`답변 ${index + 1}`}>
      <h4>답변 {index + 1}</h4>
      <p className='small muted'>등록 {kstDateTime(reply.createdAt)} · 수정 {kstDateTime(reply.updatedAt)}</p>
      <p className='admin-prose'>{reply.body}</p>
      <form
        key={reply.updatedAt}
        onSubmit={(e) => {
          e.preventDefault()
          void vm.live.updateReply(inquiryId, reply.id, val(e, 'body'))
        }}
      >
        <fieldset disabled={vm.mutationsBlocked || !!state?.pending}>
          <label className='field'>
            답변 내용<textarea className='ta' name='body' required maxLength={20000} rows={4} defaultValue={reply.body} />
          </label>
          <div className='rowend'>
            <button type='submit' className='btn sm pri'>{state?.pending ? '처리 중…' : '답변 저장'}</button>
            <button
              type='button'
              className='btn sm'
              onClick={async () => {
                if (window.confirm('이 답변을 삭제할까요? 삭제 후 복구할 수 없어요.') && await vm.live.deleteReply(inquiryId, reply.id)) onDeleted()
              }}
            >
              답변 삭제
            </button>
          </div>
        </fieldset>
        <AdminActionStatus state={state} />
      </form>
    </article>
  )
}

/** 71 관리자 계정 등록·권한: Core 관리자 생성 후 운영 서비스에 업무 권한 저장 */
function Admins({ vm }: { vm: VM }) {
  const rows = vm.live.data?.admins ?? []
  return (
    <>
      <form
        className='panel'
        onSubmit={async (e) => {
          e.preventDefault()
          const form = e.currentTarget
          const permissions = new FormData(form).getAll('adminPermission').map(String)
          if (await vm.live.createAdmin({ email: val(e, 'email'), nickname: val(e, 'nickname'), password: val(e, 'password'), permissions })) form.reset()
        }}
      >
        <h2 className='panel-title'>관리자 계정 생성</h2>
        <p className='admin-note'>모든 항목은 필수예요. 권한은 한 가지 이상 골라 주세요.</p>
        <div className='form-grid' style={{ marginTop: 12 }}>
          <label className='field'>
            이메일<input className='inp' name='email' type='email' maxLength={254} autoComplete='off' required />
          </label>
          <label className='field'>
            닉네임<input className='inp' name='nickname' maxLength={80} required />
          </label>
          <label className='field'>
            초기 비밀번호<input className='inp' name='password' type='password' minLength={8} autoComplete='new-password' aria-describedby='admin-password-help' required />
          </label>
        </div>
        <p id='admin-password-help' className='admin-note'>초기 비밀번호는 8자 이상이에요.</p>
        <fieldset className='admin-permissions' style={{ marginTop: 12 }}>
          <legend>부여할 권한</legend>
          <div className='admin-perm-grid'>
            {ADMIN_PERMISSIONS.map(([k, l]) => (
              <label key={k}>
                <input type='checkbox' name='adminPermission' value={k} />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
        <div className='rowend'>
          <button className='btn pri' type='submit' disabled={blocked(vm, 'admin:new')}>
            {vm.actions['admin:new']?.pending ? '추가 중…' : '관리자 계정 추가'}
          </button>
        </div>
        <p className='admin-note'>
          계정 생성 후 권한 저장이 실패하면 권한 없는 관리자 계정이 남을 수 있어요. 결과는 아래 목록에서 확인해 주세요.
        </p>
      </form>
      <div className='panel' style={{ marginTop: 14 }}>
        <div className='table-head'>
          <h2 className='panel-title'>관리자 계정</h2>
        </div>
        <LiveState vm={vm} label='관리자 목록' />
        {vm.live.data && (rows.length
          ? (
            <Table label='관리자 계정 표'>
              <thead>
                <tr>
                  <th scope='col'>닉네임</th>
                  <th scope='col'>이메일</th>
                  <th scope='col'>권한</th>
                  <th scope='col'>등록일</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.nickname}</b>
                      {a.restricted && <span className='chip wait'>이용 제한</span>}
                    </td>
                    <td>{a.email}</td>
                    <td>
                      {ADMIN_PERMISSIONS.filter(([k]) => a.permissions.includes(k)).map(([, l]) => l).join(', ') || '없음'}
                    </td>
                    <td>{kstDateTime(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
          : <p className='admin-empty'>등록된 관리자가 없어요.</p>)}
      </div>
    </>
  )
}

/** A15 로그인한 관리자 계정. 수정은 회원 계정 화면의 실제 프로필 API를 씁니다. */
function Profile({ vm }: { vm: VM }) {
  const { nick, email } = vm.me
  return (
    <div className='panel'>
      <div className='mehead'>
        <span className='meav big'>{nick.slice(0, 1)}</span>
        <div>
          <b>{nick}</b>
          <small>{email} · 관리자 계정</small>
        </div>
      </div>
      <div className='rowend' style={{ marginTop: 14 }}>
        <Link to='/auth/forgot-password' className='btn'>비밀번호 재설정</Link>
        <Link to='/me/profile' className='btn pri'>닉네임·이메일 변경</Link>
      </div>
      <p className='admin-note'>계정 정보 변경은 회원 계정 화면에서 해요. 이메일은 새 주소 확인이 끝나야 바뀌어요.</p>
    </div>
  )
}

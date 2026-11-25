import { Fragment, type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { LINK_PATH_MAX } from '../../../../domain/entities/event'
import { ADMIN_PERMISSIONS, LLM_PAGES, PIPELINE_FLOWS, type AdminTab, type LlmPage, adminTab, llmPage, llmPageHref, pipelineFlowHref, promptNavState } from '../../../../domain/entities/admin'
import { ACTIVITY_FORBIDDEN, activityActionLabel, activityActor, activityDetail, activityTarget } from '../../../../domain/entities/adminActivity'
import { REPORT_STATUSES, reportKindLabel, reportStatusLabel, reportTargetTitle, reportTargetTypeLabel } from '../../../../domain/entities/report'
import { toKoreanDateTimeInput } from '../../../../domain/entities/operations'
import { commentWorkOptions, filterOperationsComments } from '../../../../domain/entities/operationsComment'
import { rightsLabel } from '../../../../domain/entities/operationsWork'
import { SUPPORT_STATUSES, supportStatusLabel, type SupportReply } from '../../../../domain/entities/supportInquiry'
import { ofKind } from '../../../../domain/entities/work'
import { kstDateTime, kstPeriod } from '../../../shared/format'
import { EventStatusChip } from '../../../shared/EventStatusChip'
import { Go } from '../../../shared/Go'
import { MoreVerticalIcon } from '../../../shared/icons'
import { PopMenu } from '../../../shared/PopMenu'
import { ReportHistoryList } from '../../../shared/reports/ReportHistoryList'
import { Footer } from '../../../shared/shell/Gnb'
import { ThemeButton } from '../../../shared/shell/ThemeButton'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import type { AdminFilter as Filter } from '../state/adminViewSlice'
import { LIVE_TABS, useAdminViewModel, useForkIntegrity } from '../viewmodel/useAdminViewModel'
import { useFeedbackReportsViewModel } from '../viewmodel/useFeedbackReportsViewModel'
import { AdminCardCategories } from './AdminCardCategories'
import { AdminFeedbackReports } from './AdminFeedbackReports'
import { AdminGenres } from './AdminGenres'
import { AdminWorkDetail } from './AdminWorkDetail'
import { AdminWorlds } from './AdminWorlds'
import { CreditsOperations } from './CreditsOperations'
import { JobMonitor } from './JobMonitor'
import { LlmOps } from './LlmOps'
import { OperationsDashboard } from './OperationsDashboard'
import { AdminActionStatus, LiveState, OperationsNotices, Table } from './OperationsPanels'
import { useAdminDetailFocus } from './useAdminDetailFocus'

type VM = ReturnType<typeof useAdminViewModel>
type Data = NonNullable<VM['data']>

/**
 * 운영 업무 대상별 메뉴: 회원 → 콘텐츠 → 소통 → LLM Ops → 서비스. 대시보드는 묶음 없이 맨 위 단독 항목이고, 프로필·로그아웃은 상단바 닉네임 메뉴에 있습니다.
 * LLM Ops의 세 메뉴는 같은 탭(llm)의 쪽이라 세 번째 값에 쪽(view)을 적습니다. 프롬프트·평가는 그 아래 하위 탭(AI 파이프라인의 워크플로우, #857 3차 정정)을 펼칩니다.
 */
const GROUPS: [string, [AdminTab, string, LlmPage?][]][] = [
  ['회원 관리', [['users', '사용자'], ['admins', '관리자 계정·권한']]],
  ['콘텐츠 관리', [['works', '작품'], ['worlds', '세계관'], ['rights', '신고·권리'], ['comments', '댓글'], ['characterChats', '캐릭터챗'], ['genres', '장르'], ['cardCategories', '카드 카테고리']]],
  ['소통 관리', [['feedback', '제보·문의'], ['notices', '공지'], ['events', '이벤트']]],
  ['LLM Ops', LLM_PAGES.map(([page, label]): [AdminTab, string, LlmPage] => ['llm', label, page])],
  ['서비스 운영', [['jobs', '정기 작업'], ['credits', '크레딧'], ['audit', '활동 로그']]],
]
/** LLM Ops는 쪽마다 제목(문서 제목 포함)이 다릅니다. */
const LLM_TITLES: Record<LlmPage, [string, string]> = {
  metrics: ['LLM Ops · 에이전트 지표', 'AI 요청·경고 요약과 최근 7일 사용, 에이전트(기능)별 요청·실패율·지연·비용을 카드로 보고 Langfuse 추적을 찾아 봅니다.'],
  prompts: ['LLM Ops · 프롬프트·평가', '에이전트별 평가에서 프롬프트의 개선 루프(프롬프트·평가 세트·평가·자동 개선·게이트·서비스 반영)를 따라가며 모델 단가와 AI 파이프라인도 봅니다.'],
  alerts: ['LLM Ops · 경고·누설 감시', '운영 경고를 확인하고 조치하며, 경고 기준과 정보 누설 검사 기록·표본 비율을 관리합니다.'],
}
const TITLES: Record<Exclude<AdminTab, 'llm'>, [string, string]> = {
  data: ['대시보드', '회원·작업·미처리 업무 카드와 서비스 지표(전체 기간)를 확인합니다. AI 요청·경고와 에이전트별 지표는 LLM Ops 에이전트 지표에 있습니다.'],
  rights: ['신고·권리 관리', '운영 신고를 검토하고 대상(작품·회차·세계관) 제한·권리 증빙 요청을 기록합니다.'],
  admins: ['관리자 계정과 권한', '업무별 접근 권한을 나누어 관리자 계정을 추가합니다.'],
  users: ['사용자 관리', '회원 목록을 조회하고 이용 제한·해제를 요청합니다.'],
  works: ['작품 관리', '작품의 공개 상태와 이용 권리를 조회하고 운영 제한·해제를 요청합니다. 작품 상세에서 회차를 확인하고 제한합니다.'],
  worlds: ['세계관 관리', '공개 세계관을 조회하고 공개 경로 운영 제한·해제를 요청합니다.'],
  cardCategories: ['카드 카테고리 관리', '세계관 카드의 분류를 추가하고 이름·아이콘·숨김·순서를 관리합니다.'],
  genres: ['장르 관리', '작품·세계관이 함께 쓰는 장르를 추가하고 이름·아이콘·숨김·홈 노출·순서를 관리합니다.'],
  characterChats: [
    '캐릭터챗 관리',
    '공개 작품의 원작·포크와 캐릭터를 선택해 챗을 추가하거나 운영 상태를 바꿉니다.',
  ],
  comments: ['댓글 관리', '독자 댓글을 조회하고 숨김·게시 복구를 요청합니다.'],
  feedback: [
    '제보·문의',
    '회원이 보낸 고객지원 문의를 확인하고 답변합니다. 작가 검토 제보는 열람만 하고, 처리는 작가가 해요.',
  ],
  jobs: ['정기 작업', '원고 전처리와 운영 정기 작업의 실행 기록을 보고 실패 작업과 일정을 관리합니다.'],
  events: ['이벤트 관리', '이벤트 내용과 기간을 관리합니다.'],
  notices: ['공지 게시', '공지를 작성하고 수정·삭제합니다.'],
  credits: ['크레딧 관리', '회원의 크레딧 잔액·내역을 조회하고 수동 지급·회수를 요청합니다.'],
  audit: ['관리자 활동 로그', '관리자가 수행한 변경 조치를 최신순으로 보여 줍니다.'],
  profile: ['관리자 프로필', '로그인한 관리자 계정 정보를 확인합니다.'],
}
const KINDS: [string, string][] = [['all', '전체'], ['original', '원작'], ['fork', '포크']]
/** 데모 조회를 쓰지 않는 운영 API 탭: 상단 '목록 새로고침'(데모 조회만 다시 읽음) 대신 자기 패널의 새로고침·조회를 씁니다. */
const OPS_TABS: AdminTab[] = ['data', 'llm', 'jobs', 'genres', 'credits', 'worlds', 'cardCategories']
const has = (q: string, ...xs: string[]) =>
  !q || xs.join(' ').toLocaleLowerCase().includes(q.toLocaleLowerCase())
const blocked = (vm: VM, key: string) => vm.mutationsBlocked || !!vm.actions[key]?.pending
/** 폼 안에 상태를 그리는 조치(공지·이벤트·문의 답변·신고 처리·관리자 계정 생성과 대시보드·LLMOps·작업 감시 패널)의 키. 그 밖의 키는 표의 행 조치라 화면 위에서 안내합니다. */
const OPS_PANEL_KINDS = ['alert', 'prompt', 'model', 'eval', 'rule', 'setting', 'run', 'schedule', 'genre', 'credit', 'world', 'cardCategory', 'episode', 'admin']
const IN_FORM = new RegExp(`^(notice|event|inquiry|report|${OPS_PANEL_KINDS.join('|')}):`)
/** 행 조치 키(`member:<id>` 등)의 대상을 화면에 보이는 이름으로 바꿉니다. 목록에서 찾지 못하면 이름 없이 안내합니다. */
function actionTarget(vm: VM, key: string): string | undefined {
  const [kind, id] = key.split(':')
  const live = vm.live.data
  if (kind === 'member') { const m = live?.members.find((x) => x.id === id); return m && `${m.nickname} 님` }
  if (kind === 'work') { const w = live?.works.find((x) => x.workId === id); return w && `「${w.title}」` }
  if (kind === 'comment') { const c = live?.comments.find((x) => x.commentId === id); return c && `${c.authorName} 님의 댓글` }
  if (kind === 'chat') { const c = vm.data?.chats.find((x) => x.id === id); return c ? `${c.w.title} · ${c.character}` : id === 'new' ? '캐릭터챗 추가' : undefined }
  return undefined
}
/**
 * 이 키의 조치 상태가 지금 화면의 폼 안에 그려지는지. 그려지면 완료 문구가 폼 안에 보이므로 화면 위 완료 줄에 같은 문구를 또 두지 않습니다.
 * 새로 저장해 상세로 넘어가거나 삭제해 폼이 사라진 조치는 폼 안에 남지 않으므로 화면 위 완료 줄이 맡습니다.
 */
function shownInForm(vm: VM, tab: AdminTab, key: string) {
  const [kind, id, , replyId] = key.split(':')
  // 대시보드·LLMOps·작업 감시 패널(ActionLines)과 관리자 계정 폼(AdminActionStatus)은 자기 조치 안내를 패널·폼 안에 그립니다.
  if (OPS_PANEL_KINDS.includes(kind)) return true
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

/** 목업 admin(): 자체 상단바·업무 메뉴. 데모 화면 가림일 뿐이며 실제 권한 검사는 Core가 맡아야 합니다. */
export function AdminPage() {
  const [q] = useSearchParams()
  const tab = adminTab(q.get('tab'))
  const page = llmPage(q.get('view'))
  // 사이드바 프롬프트·평가 아래 하위 탭: 그 쪽에 있을 때만 펼쳐지고, 켜진 하위 탭은 AI 파이프라인(전체) 보기의 flow입니다.
  const { open, current: subTab } = promptNavState(tab, page, q.get('sub'), q.get('flow'))
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
  const [title, desc] = tab === 'llm' ? LLM_TITLES[page] : TITLES[tab]
  const live = LIVE_TABS.includes(tab)
  useDocumentTitle(`관리자 · ${title}`)
  const nav = useRef<HTMLElement>(null)
  // 모바일 가로 메뉴나 높이를 넘겨 스스로 스크롤되는 세로 메뉴에서 현재 탭이 메뉴의 보이는 영역 밖에 있을 때만 보이게 합니다. 이미 보이면 건드리지 않아 맨 위 브랜드가 밀려나지 않습니다.
  useEffect(() => {
    // scrollIntoView는 키보드 Tab 시작점까지 옮기므로 메뉴의 스크롤 값만 바꿉니다.
    const n = nav.current
    const a = n?.querySelector('[aria-current="page"]')
    if (!n || !a) return
    const at = a.getBoundingClientRect()
    const box = n.getBoundingClientRect()
    // 보이는 구간 밖으로 벗어난 쪽으로만, 16px 여유를 두고 옮길 양입니다. 이미 보이면 0.
    const reveal = (start: number, end: number, boxStart: number, boxEnd: number) =>
      start < boxStart ? start - boxStart - 16 : end > boxEnd ? end - boxEnd + 16 : 0
    const dx = n.scrollWidth > n.clientWidth ? reveal(at.left, at.right, box.left, box.right) : 0
    const dy = n.scrollHeight > n.clientHeight ? reveal(at.top, at.bottom, box.top, box.bottom) : 0
    if (dx) n.scrollLeft += dx
    if (dy) n.scrollTop += dy
  }, [tab, page, subTab])
  const content = useRef<HTMLElement>(null)
  // 머리 오른쪽 자리(데모 칩·목록 새로고침). 대시보드 탭은 자기 새로고침을 이 자리에 포털로 두므로 요소를 상태로 들고 있다가 건넵니다.
  const [headSide, setHeadSide] = useState<HTMLDivElement | null>(null)
  const successTarget = IN_FORM.test(vm.lastSuccessKey) ? undefined : actionTarget(vm, vm.lastSuccessKey)
  // 운영 API가 없는 데모 탭만 메뉴에 '데모' 배지를 답니다. 배지는 읽지 않게 두는 대신 링크 설명으로 스크린리더에 알립니다(링크 이름은 그대로).
  // 현재 표시는 탭과 쪽(view)이 모두 같을 때만 켭니다. LLM Ops 세 메뉴는 같은 탭이라 쪽까지 같아야 합니다.
  // 하위 탭이 있는 쪽 링크(프롬프트·평가)는 펼침 표시(▾/▸)와 aria-expanded를 달고, 하위 탭이 켜져 있으면 현재 표시는 그 하위 탭 하나에만 두고 쪽 링크는 열림(open)만 표시합니다.
  const navLink = (k: AdminTab, l: string, view?: LlmPage) => {
    const parent = view === 'prompts'
    const on = tab === k && (!view || view === page) && !(parent && subTab)
    const to = view ? llmPageHref(view) : `/admin?tab=${k}`
    const link = (
      <Go
        key={to}
        to={to}
        className={[on && 'on', parent && open && 'open'].filter(Boolean).join(' ')}
        aria-current={on ? 'page' : undefined}
        aria-describedby={LIVE_TABS.includes(k) ? undefined : 'admin-demo-note'}
        aria-expanded={parent ? open : undefined}
        aria-controls={parent ? 'admin-prompts-subnav' : undefined}
      >
        {l}
        {!LIVE_TABS.includes(k) && <span className='nav-demo' aria-hidden='true'>데모</span>}
        {parent && <span className='nav-caret' aria-hidden='true'>{open ? '▾' : '▸'}</span>}
      </Go>
    )
    if (!parent) return link
    return (
      <Fragment key={to}>
        {link}
        <ul id='admin-prompts-subnav' className='admin-subnav' aria-label={`${l} 하위 메뉴`} hidden={!open}>
          {PIPELINE_FLOWS.map(([flow, label]) => (
            <li key={flow}>
              <Go to={pipelineFlowHref(flow)} className={flow === subTab ? 'on' : ''} aria-current={flow === subTab ? 'page' : undefined}>{label}</Go>
            </li>
          ))}
        </ul>
      </Fragment>
    )
  }
  // 새 공지·이벤트 폼은 목록이 보이지 않아 새로고침해도 화면이 안 바뀌므로 숨깁니다(목록·기존 글 상세에서는 다시 읽는 수단).
  const showRefresh = !!d && !vm.isError && !OPS_TABS.includes(tab) && !((tab === 'events' || tab === 'notices') && vm.recordSelection[tab] === 'new')
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
      <div className='admin-side'>
        <nav ref={nav} className='admin-nav' aria-label='관리자 업무'>
          <Go to='/' className='admin-brand' aria-label='STORYFORK 관리자 · 메인 페이지로' title='메인 페이지로'>STORYFORK 관리자</Go>
          {navLink('data', '대시보드')}
          {/* 메뉴 묶음 이름은 본문 제목(h1)보다 앞에 오므로 제목으로 읽히지 않게 하고, 묶음 이름은 group의 레이블로 전합니다. */}
          {GROUPS.map(([g, items]) => (
            <section key={g} role='group' aria-label={g}>
              <h2 role='presentation'>{g}</h2>
              {items.map(([k, l, view]) => navLink(k, l, view))}
            </section>
          ))}
          <span id='admin-demo-note' className='sr-only'>데모 화면이에요</span>
        </nav>
      </div>
      <div className='admin-col'>
        <div className='top'>
          {/* 900px 이하에서만 보이는 브랜드: 가로로 스크롤되는 메뉴 안 브랜드는 잘려서 상단바 왼쪽에 한 번 더 둡니다. 두 브랜드 모두 메인(/)으로 나가는 링크입니다. */}
          <Go to='/' className='admin-brand-top' aria-label='STORYFORK 관리자 · 메인 페이지로' title='메인 페이지로'>STORYFORK 관리자</Go>
          <PopMenu
            className='admin-who'
            label={`${vm.me.nick} 님 계정 메뉴`}
            icon={<><span className='admin-who-name'>{vm.me.nick} 님</span><span aria-hidden='true'>▾</span></>}
          >
            <Go to='/admin?tab=profile' role='menuitem' aria-current={tab === 'profile' ? 'page' : undefined}>프로필</Go>
            <button type='button' role='menuitem' onClick={vm.logout}>로그아웃</button>
          </PopMenu>
          <ThemeButton className='btn sm' />
        </div>
        <main id='main' tabIndex={-1}>
          <section ref={content} id='admin-content' tabIndex={-1} className='workspace'>
            <header className='admin-head'>
              <div>
                <h1>{title}</h1>
                <p>{desc}</p>
              </div>
              <div className='admin-head-side' ref={setHeadSide}>
                {!live && <span className='chip wait'>데모 화면</span>}
                {showRefresh && (
                  <button type='button' className='btn sm' onClick={vm.retry} disabled={vm.isRefreshing}>
                    목록 새로고침
                  </button>
                )}
              </div>
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
            {/* 행 조치의 진행·실패는 버튼에서 떨어진 여기에 보이므로 대상 이름을 붙입니다. 완료는 위의 완료 줄이 맡습니다. */}
            {Object.entries(vm.actions)
              .filter(([key]) => !IN_FORM.test(key))
              .map(([key, state]) => <AdminActionStatus key={key} state={state} target={actionTarget(vm, key)} done={false} />)}
            {(d || live) && (
              <Body key={tab} tab={tab} page={page} d={d} vm={vm} f={f} setF={setF} sel={sel} setSel={setSel} headSide={headSide} />
            )}
          </section>
        </main>
      </div>
    </div>
    <Footer />
    </>
  )
}

type BodyProps = {
  tab: AdminTab
  /** LLM Ops 탭에서 볼 쪽(주소의 view). 다른 탭에서는 쓰지 않습니다. */
  page: LlmPage
  /** 데모 조회 결과. 데모 탭(characterChats·credits)만 이 값이 있어야 그리고, 운영 API 탭은 이 값 없이도 그립니다. */
  d: Data | undefined
  vm: VM
  f: Filter
  setF: (x: Partial<Filter>) => void
  sel: string | null
  setSel: (s: string) => void
  /** 제목 줄 오른쪽 자리. 대시보드 탭이 새로고침을 여기에 둔다. */
  headSide: HTMLElement | null
}

/** 목업 adminExtra()의 controls(): (작품·댓글·캐릭터챗) 검색과 분류·정렬. 왼쪽 정렬 한 줄에 검색 입력 → 분류 → 정렬 → 검색 버튼 순서이고 좁으면 줄을 바꿉니다. */
function Controls(
  { tab, f, setF, categories, sorts }: Pick<BodyProps, 'tab' | 'f' | 'setF'> & {
    categories: [string, string][]
    sorts: [string, string][]
  },
) {
  const label = tab === 'works' ? '작품 검색' : tab === 'comments' ? '댓글 검색' : '캐릭터챗 검색'
  return (
    <form
      className='admin-filter'
      onSubmit={(e) => {
        e.preventDefault()
        setF({ query: val(e, 'query').trim() })
      }}
    >
      <label className='field field-search'>
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
      <button className='btn' type='submit'>검색</button>
    </form>
  )
}

function Body(p: BodyProps) {
  const { tab, d, vm, f } = p
  if (tab === 'data') return <OperationsDashboard vm={vm} headSide={p.headSide} />
  if (tab === 'llm') return <LlmOps vm={vm} page={p.page} />
  if (tab === 'jobs') return <JobMonitor vm={vm} />
  if (tab === 'genres') return <AdminGenres vm={vm} />
  if (tab === 'worlds') return <AdminWorlds vm={vm} />
  if (tab === 'cardCategories') return <AdminCardCategories vm={vm} />
  if (tab === 'credits') return <CreditsOperations vm={vm} />
  if (tab === 'rights') return <Rights {...p} />
  if (tab === 'admins') return <Admins vm={vm} />
  if (tab === 'users') return <Users {...p} />
  if (tab === 'profile') return <Profile vm={vm} />
  if (tab === 'works') return <Works {...p} />
  if (tab === 'comments') return <Comments {...p} />
  if (tab === 'audit') return <Audit vm={vm} />
  // 운영 API 탭이라 데모 조회(d) 없이 그린다(Feedback의 서버 없는 시연(`--mode mockup`) 제보 표만 d가 있을 때 붙는다).
  if (tab === 'feedback') return <Feedback {...p} />
  if (tab === 'events') return <Events vm={vm} />
  if (tab === 'notices') {
    return (
      <>
        <LiveState vm={vm} label='공지 목록' />
        <OperationsNotices vm={vm} />
      </>
    )
  }
  if (!d) return null
  const titleSort = (
    a: string,
    b: string,
  ) => (f.sort === 'titleDesc' ? b.localeCompare(a, 'ko') : a.localeCompare(b, 'ko'))
  let T: ReactNode
  if (tab === 'characterChats') {
    const list = d.chats.filter((c) =>
      ofKind(f.category, c.w) && has(f.query, c.w.title, c.character)
    ).sort((a, b) =>
      titleSort(a.w.title, b.w.title) || a.character.localeCompare(b.character, 'ko')
    )
    T = (
      <>
        <ChatForm d={d} vm={vm} />
        <div className='panel'>
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
                <th scope='col' className='act act-menu'><span className='sr-only'>관리</span></th>
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
                    <td className='act-menu'>
                      <PopMenu className='row-menu' label={`「${c.w.title} ${c.character}」 조치`} icon={<MoreVerticalIcon />}>
                        <button type='button' role='menuitem' disabled={blocked(vm, `chat:${c.id}`)} onClick={() => vm.toggleChat(c.id)}>
                          {c.enabled === false ? '운영 재개' : '중지'}
                        </button>
                      </PopMenu>
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
  }
  return T
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
        최신 100건까지 보여 줘요. 회원·관리자 계정·신고·작품·장르·공지·이벤트·문의 답변·크레딧 지급·회수의 변경 조치가 성공하면 운영 서버에 남고,
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
  // 작품 상세 드로어(결정 C): 행을 누르거나 ⋮ 메뉴의 '상세'를 고르면 열린다. 목록 검색·정렬이 바뀌어도 열린 채 두려고 전체 목록에서 찾는다.
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = (vm.live.data?.works ?? []).find((w) => w.workId === detailId)
  const closeDetail = () => {
    // 닫으면 초점이 body로 떨어지지 않게 그 줄의 ⋮ 버튼으로 돌려준다.
    root.current?.querySelector<HTMLElement>(`[data-record-id="${detailId}"] button`)?.focus()
    setDetailId(null)
  }
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
              <th scope='col' className='act act-menu'><span className='sr-only'>조치</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length
              ? rows.map((w) => (
                <tr key={w.workId} className={`click${integrity.target?.id === w.workId || detailId === w.workId ? ' sel' : ''}`} onClick={() => setDetailId(w.workId)}>
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
                  {/* 행을 누르면 작품 상세가 열리므로, ⋮ 메뉴를 여는 누름은 행까지 올라가지 않게 한다. */}
                  <td className='act-menu' data-record-id={w.workId} onClick={(e) => e.stopPropagation()}>
                    <PopMenu className='row-menu' label={`「${w.title}」 조치`} icon={<MoreVerticalIcon />}>
                      <button type='button' role='menuitem' aria-current={detailId === w.workId ? 'true' : undefined} onClick={() => setDetailId(w.workId)}>상세</button>
                      <button
                        type='button'
                        role='menuitem'
                        className={w.restricted ? undefined : 'danger'}
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
                        <button type='button' role='menuitem' onClick={() => integrity.select({ id: w.workId, title: w.title })}>
                          포크 정합성 점검
                        </button>
                      )}
                      {/* 운영자는 소유권 없이 모든 작품을 연다(2026-11-23 사용자 결정). */}
                      <Link role='menuitem' to={`/work/${w.workId}`}>소설 보기</Link>
                      <Link role='menuitem' to={`/studio/${w.workId}`}>집필실 보기</Link>
                    </PopMenu>
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
      {detail && <AdminWorkDetail vm={vm} work={detail} onClose={closeDetail} />}
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
        이 조치는 신고 사건에는 남기지 않고 활동 로그에만 기록해요. 작품 행을 누르거나 ⋮ 메뉴의 ‘상세’를 고르면 회차 목록·연결 세계관이 열리고 회차 단위로도 제한할 수 있어요.
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
              <th scope='col' className='act act-menu'><span className='sr-only'>조치</span></th>
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
                  <td className='admin-date'>{kstDateTime(c.createdAt)}</td>
                  <td className='act-menu'>
                    <PopMenu className='row-menu' label={`「${c.authorName} 댓글」 조치`} icon={<MoreVerticalIcon />}>
                      <button
                        type='button'
                        role='menuitem'
                        disabled={blocked(vm, `comment:${c.commentId}`)}
                        onClick={() => {
                          if (c.hidden || window.confirm(`「${c.workTitle}」의 댓글을 숨길까요? 독자에게는 자리표시로만 보여요.`)) {
                            void vm.live.setCommentHidden(c.commentId, !c.hidden)
                          }
                        }}
                      >
                        {c.hidden ? '게시 복구' : '숨김'}
                      </button>
                    </PopMenu>
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
      <form
        className='admin-filter'
        onSubmit={(e) => {
          e.preventDefault()
          setF({ query: val(e, 'query').trim() })
        }}
      >
        <label className='field field-search'>
          사용자 검색<input className='inp' name='query' type='search' defaultValue={f.query} placeholder='이름·이메일' />
        </label>
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
        <button className='btn' type='submit'>검색</button>
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
                <th scope='col' className='act act-menu'><span className='sr-only'>조치</span></th>
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
                  <td className='admin-date'>{kstDateTime(u.createdAt)}</td>
                  <td>
                    <span className={`chip ${u.restricted ? 'wait' : 'ok'}`}>{u.restricted ? '이용 제한' : '이용 가능'}</span>
                  </td>
                  <td className='act-menu'>
                    {u.id === vm.selfId
                      ? <span className='small muted'>본인 계정</span>
                      : (
                        <PopMenu className='row-menu' label={`「${u.nickname}」 조치`} icon={<MoreVerticalIcon />}>
                          <button
                            type='button'
                            role='menuitem'
                            className={u.restricted ? undefined : 'danger'}
                            disabled={blocked(vm, `member:${u.id}`)}
                            onClick={() => {
                              if (u.restricted || window.confirm(`${u.nickname} 님의 로그인을 막을까요? 제한 해제 전까지 로그인할 수 없어요.`)) {
                                void vm.live.setMemberRestriction(u.id, !u.restricted)
                              }
                            }}
                          >
                            {u.restricted ? '제한 해제' : '이용 제한'}
                          </button>
                        </PopMenu>
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
function Rights({ vm, f, setF, sel, setSel }: BodyProps) {
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
        </div>
        <div className='admin-filter'>
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
                  <th scope='col'>대상</th>
                  <th scope='col'>대상 종류</th>
                  <th scope='col'>종류</th>
                  <th scope='col'>사유</th>
                  <th scope='col'>상태</th>
                  <th scope='col'>대상 제한</th>
                  <th scope='col'>접수</th>
                  <th scope='col' className='act act-menu'><span className='sr-only'>처리</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id} className={`click ${sel === x.id ? 'sel' : ''}`} onClick={() => setSel(x.id)}>
                    <td>
                      <b>{reportTargetTitle(x)}</b>
                    </td>
                    <td>{reportTargetTypeLabel(x.targetType)}</td>
                    <td>{reportKindLabel(x.kind)}</td>
                    <td>{x.reason}</td>
                    <td>
                      <span className={`chip ${x.status === 'RECEIVED' ? 'wait' : 'ok'}`}>{reportStatusLabel(x.status)}</span>
                    </td>
                    <td>{x.contentRestricted ? '제한 중' : '공개 유지'}</td>
                    <td className='admin-date'>{kstDateTime(x.createdAt)}</td>
                    {/* 행을 누르면 신고가 선택되므로, ⋮ 메뉴를 여는 누름은 행까지 올라가지 않게 한다. */}
                    <td className='act-menu' onClick={(e) => e.stopPropagation()}>
                      <PopMenu className='row-menu' label={`「${reportTargetTitle(x)} 신고」 조치`} icon={<MoreVerticalIcon />}>
                        <button type='button' role='menuitem' aria-current={sel === x.id ? 'true' : undefined} onClick={() => setSel(x.id)}>
                          {sel === x.id ? '검토 중' : '검토'}
                        </button>
                      </PopMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
          : <p className='admin-empty'>조건에 맞는 신고가 없어요.</p>)}
      </div>
      {sel && (
        <div className='panel admin-operations' id='a04'>
          {detail.isError && (
            <div className='admin-action-error' role='alert'>
              <p>신고 상세를 불러오지 못했어요. 목록을 새로고침한 뒤 다시 선택해 주세요.</p>
              <button type='button' className='btn sm' onClick={detail.retry}>다시 불러오기</button>
            </div>
          )}
          {!r && !detail.isError && <p role='status'>신고 상세를 불러오고 있어요.</p>}
          {r && (
            <>
              <h2 ref={heading} tabIndex={-1} className='admin-section-title'>신고 상세 · {reportTargetTitle(r)}</h2>
              <dl className='ai'>
                <dt>대상 종류</dt>
                <dd>{reportTargetTypeLabel(r.targetType)}</dd>
                <dt>종류</dt>
                <dd>{reportKindLabel(r.kind)}</dd>
                <dt>상태</dt>
                <dd>
                  <div className='report-state'>
                    <span>{reportStatusLabel(r.status)} · {reportTargetTypeLabel(r.targetType)} {r.contentRestricted ? '제한 중' : '공개 유지'}</span>
                    <button
                      type='button'
                      className='btn sm'
                      disabled={busy}
                      onClick={() => {
                        if (r.contentRestricted || window.confirm(`「${reportTargetTitle(r)}」을(를) 제한할까요? 해제 전까지 독자에게 보이지 않아요.`)) {
                          void vm.live.setContentRestriction(r.id, !r.contentRestricted)
                        }
                      }}
                    >
                      {r.contentRestricted ? `${reportTargetTypeLabel(r.targetType)} 제한 해제` : `${reportTargetTypeLabel(r.targetType)} 제한`}
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
              <option key={w.id} value={w.id}>{w.title}{form.kind === 'all' ? (w.parent ? ' · 포크' : ' · 원작') : ''}</option>
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
            {cast.length ? cast.map((c) => <option key={c.n} value={c.n}>{c.n} · {c.d}</option>) : <option value=''>선택할 수 있는 캐릭터가 없어요</option>}
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
    linkPath: row?.linkPath ?? '',
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
                      <label className='field wide'>
                        이동 경로(선택)<input
                          className='inp'
                          maxLength={LINK_PATH_MAX}
                          placeholder='/lib?tab=worlds'
                          value={form.linkPath}
                          aria-describedby='event-link-help'
                          onChange={(e) => vm.setEventDraft(key, { ...form, linkPath: e.target.value })}
                        />
                      </label>
                      <p id='event-link-help' className='small muted wide'>
                        사이트 안 경로만 쓸 수 있어요(/로 시작, 외부 주소·공백 불가, 200자 이하). 쓰면 회원 이벤트 안내에 ‘바로 가기’ 버튼이 보여요.
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

/** 67 고객지원 문의: 회원이 보낸 문의 목록·상세와 답변 등록·수정·삭제. 그 아래 작가 검토 제보는 운영 API의 독자 제보를 읽기만 하고(#750), 서버 없는 `--mode mockup`만 기존 메모리 데모 표를 그대로 둡니다. */
function Feedback({ d, vm, f, setF }: BodyProps) {
  const selection = vm.recordSelection.inquiries
  const list = vm.live.inquiries
  const rows = list.data ?? []
  const detail = vm.live.inquiry
  const row = detail.data?.id === selection ? detail.data : null
  const root = useAdminDetailFocus(selection, !!row, rows.length)
  const replyHeading = useRef<HTMLHeadingElement>(null)
  const adding = vm.actions[`inquiry:${selection}:reply`]
  const authorReports = useFeedbackReportsViewModel()
  return (
    <>
      <section className='panel admin-operations' aria-label='회원 고객지원 문의' ref={root}>
        {!selection
          ? (
            <>
              <div className='table-head'>
                <h2 tabIndex={-1}>회원 문의</h2>
              </div>
              <div className='admin-filter'>
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
      {authorReports ? <AdminFeedbackReports vm={vm} reports={authorReports} /> : d && (
        <div className='panel'>
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
            <button type='submit' className='btn sm'>{state?.pending ? '처리 중…' : '답변 저장'}</button>
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
          <label className='field wide'>
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
        <AdminActionStatus state={vm.actions['admin:new']} />
        <p className='admin-note'>
          계정 생성 후 권한 저장이 실패하면 권한 없는 관리자 계정이 남을 수 있어요. 결과는 아래 목록에서 확인해 주세요.
        </p>
      </form>
      <div className='panel'>
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
                    <td className='admin-nowrap'>
                      <b>{a.nickname}</b>
                      {a.restricted && <span className='chip wait'>이용 제한</span>}
                    </td>
                    <td className='admin-nowrap'>{a.email}</td>
                    <td>
                      {ADMIN_PERMISSIONS.filter(([k]) => a.permissions.includes(k)).map(([, l]) => l).join(', ') || '없음'}
                    </td>
                    <td className='admin-date'>{kstDateTime(a.createdAt)}</td>
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

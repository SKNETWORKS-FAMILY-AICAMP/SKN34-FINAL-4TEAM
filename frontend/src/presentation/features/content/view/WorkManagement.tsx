import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { SERIAL_LOCK_NOTICE, serialEpisodeLocked } from '../../../../domain/entities/aiSerial'
import { publicationActionLabel, savedVersionLabel, type Version, type Work } from '../../../../domain/entities/content'
import { initialBuildCompletedOn, worldBuildBadge } from '../../../../domain/entities/manuscriptBuild'
import { FORK_WORLD_REQUIRED } from '../../../../domain/entities/work'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { kstDateTime } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { Branch } from '../../../shared/icons'
import { ManuscriptBody } from '../../../shared/media/MediaPanel'
import { paginate } from '../../../shared/paginate'
import { Pager } from '../../../shared/Pager'
import { ManageMenu } from '../../../shared/shell/ManageMenu'
import { ScreenTour, type TourStep } from '../../../shared/tour/ScreenTour'
import { EditSuggestionInbox } from '../../inbox/view/EditSuggestionInbox'
import { FeedbackReportInbox } from '../../inbox/view/FeedbackReportInbox'
import { inboxTour } from '../../inbox/view/inboxTour'
import { MyCommentsReports } from '../../library/view/MyCommentsReports'
import { inheritedRangeLabel } from '../viewmodel/inheritedRange'
import { useEpisodeForkCounts } from '../viewmodel/useEpisodeForkCounts'
import { workDeletePrompt, type useEpisodeViewModel } from '../viewmodel/useEpisodeViewModel'
import { useManuscriptBuild } from '../viewmodel/useManuscriptBuild'
import type { WorldRelease } from '../viewmodel/unlinkWorld'
import { useWorldReleaseCheck } from '../viewmodel/useWorldReleaseCheck'
import { ContextPreview } from './ContextPreview'
import { AiSerialPanel } from './AiSerialPanel'
import { EpisodeBulkImportSheet } from './EpisodeBulkImportSheet'
import { LinkedWorldPanel } from './LinkedWorldPanel'
import { ManuscriptBuildPanel } from './ManuscriptBuildPanel'
import { ForkInfo, WorkDelete, WorkPolicy } from './WorkOperations'
import { WorkDashboard } from './WorkDashboard'
import { WorkOverview, type WorkEditing } from './WorkOverview'
import { WorkBrief } from './WorkBrief'
import { WorkSettingsPanel } from './WorkSettingsPanel'
import { WorldPanel } from './WorldPanel'
import { WorldReleaseWarning } from './WorldReleaseWarning'

// 사용법 투어(#971)의 화면 투어(첫 진입 1회, 메뉴 소개): 사이드바 메뉴 버튼(data-tour="manage-<탭>")을 짚는다. 어느 탭에 있어도 메뉴는 보인다. 사용법 버튼은 이것이 아니라 지금 탭의 투어를 연다.
const tour: TourStep[] = [
  { target: 'manage-overview', title: '개요', text: '작품 정보·표지를 고치고, 공개 회차·작성 중인 초안·받은 피드백·조회 같은 현황을 봐요. 탭은 처음 열 때마다 그 탭의 사용법이 한 번 나오고, 사용법 버튼으로 다시 볼 수 있어요.' },
  { target: 'manage-read', title: '공개 회차', text: '공개한 회차를 보고 집필실로 가요. 원고 쓰기·버전 저장·공개는 집필실에서 해요. 회차가 없어도 집필실의 새 회차 버튼으로 1화를 만들 수 있어요.' },
  { target: 'manage-world', title: '세계관·설정집', text: '이 작품에 세계관을 연결하고 설정집을 관리해요. 원고로 세계관을 만들 수도 있어요.' },
  { target: 'manage-fork', title: '이야기 분기', text: '분기를 허용한 공개 원작이면 고른 회차에서 갈라지는 작품을 만들어요.' },
  { target: 'manage-feedback', title: '받은 피드백', text: '독자가 이 작품에 보낸 문장 제보와 수정 제안을 받아 처리해요.' },
  { target: 'manage-settings', title: '운영 설정', text: '집필 방식과 분기 정책을 정하고, 작품을 삭제해요.' },
]

// 탭·패널별 사용법 투어(#971): 탭에 처음 들어갈 때(화면 투어 다음) 그 탭 안의 실제 버튼·입력을 짚는다. 대상은 data-tour="manage-<탭>-<이름>"이고, 사용법 버튼은 지금 탭의 투어를 연다.
// 내용을 불러온 뒤에 시작하며(tabReady), 화면에 없는 대상(분기 작품의 분기 정책·꺼진 기능·빈 목록)의 단계는 빠진다. 내 제보·수정 제안과 이력 탭은 투어가 없다.
// 받은 피드백 탭은 피드백함과 같은 컴포넌트라 같은 앵커(inbox-*)·같은 단계(inboxTour)를 쓴다.
const tabTours: Record<string, TourStep[]> = {
  overview: [
    { target: 'manage-overview-info', title: '작품 정보 편집', text: '제목·소개·장르·해시태그를 고쳐요. 표지는 \'표지 편집\'으로 바꿔요.' },
    { target: 'manage-overview-metrics', title: '작품 지표', text: '공개 회차·작성 중인 초안·글자 수·포크·받은 피드백, 회원 조회·좋아요를 숫자로 봐요.' },
    { target: 'manage-overview-shortcuts', title: '바로가기', text: '집필실에서 원고를 쓰고 공개해요. 공개한 작품이면 소설 상세로도 바로 가요.' },
  ],
  read: [
    { target: 'manage-read-studio', title: '집필실 열기', text: '새 회차 쓰기·원고 고치기·버전 저장·공개는 모두 집필실에서 해요. 회차가 없어도 집필실의 새 회차 버튼으로 1화를 만들 수 있어요.' },
    { target: 'manage-read-list', title: '공개 회차 목록', text: '독자가 볼 수 있는 발행본이에요. 회차마다 \'수정하기\'로 그 회차의 집필실을 열어요. 원작에서 이어받은 회차는 고칠 수 없고, AI 자율 집필을 켜면 2화부터 수정하기가 잠겨요.' },
    { target: 'manage-read-import', title: '여러 회차 올리기', text: '\'회차 파일 일괄 업로드\'는 TXT·EPUB 파일 하나를 한 회차로 저장해요. \'원고로 세계관 만들기\'는 세계관·설정집 탭으로 이동해요.' },
  ],
  world: [
    { target: 'manage-world-build', title: '원고로 세계관 만들기', text: '저장한 원고를 AI가 분석해 비공개 세계관 초안을 만들어요. 동의에 체크하고 \'세계관 만들기\'를 누르면 시작하고, 끝나면 세계관 작업실에서 직접 검토·확정해요.' },
    { target: 'manage-world-link', title: '세계관 연결', text: '이미 만든 세계관을 이 작품에 연결해요. 이름으로 검색해 고르고 \'세계관 연결\'을 누르면, 그 세계관에서 \'N화부터 공개\'로 정한 카드가 소설의 설정 위키에 나와요.' },
    { target: 'manage-world-book', title: '설정집', text: '이 작품의 설정집 상태예요. 설정 카드는 세계관 작업실에서 고치고, 원작을 따라가는 분기 작품은 \'내 세계관으로 만들어 수정하기\'로 독립해요.' },
  ],
  fork: [
    { target: 'manage-fork-form', title: '이 회차에서 분기', text: '기준 회차를 고르고 분기 작품 제목과 달라지는 점을 적은 뒤 \'이 회차에서 분기 만들기\'를 눌러요. 기준 회차까지의 공개 원고·설정·관계가 이어져요.' },
    { target: 'manage-fork-blocked', title: '분기를 열려면', text: '분기를 허용한 공개 원작에서만 만들 수 있어요. 운영 설정의 분기 정책에서 분기 만들기를 허용하고, 회차는 집필실에서 공개해 주세요.' },
  ],
  serial: [
    { target: 'manage-serial-fields', title: '연재 설정', text: '연재 요일·시각(한국시간)·연재 방향을 정해요. 운영 설정의 집필 방식에서 \'AI 자율 집필\'을 켜야 이 입력이 열려요. 꺼져 있으면 잠겨 있어요.' },
    { target: 'manage-serial-save', title: '설정 저장', text: '저장한 값은 다음 마감부터 적용돼요. 1화는 직접 써서 발행해야 2화 게시판이 열려요.' },
    { target: 'manage-serial-history', title: '게시판 기록', text: '\'게시판 기록\' 탭에서 회차별 상태와 실패 사유를 보고, \'지금 마감·실행\'으로 마감 시각을 기다리지 않고 바로 마감해 AI가 다음 회차를 쓰게 해요.' },
  ],
  feedback: inboxTour,
  settings: [
    { target: 'manage-settings-mode', title: '집필 방식', text: '직접 집필·AI 협업 집필·AI 자율 집필 중에서 골라요. AI 협업은 집필실에 AI 채팅이 함께 열리고, AI 자율 집필은 1화 발행 뒤 독자 투표와 제안을 모아 AI가 다음 회차를 써요.' },
    { target: 'manage-settings-save', title: '집필 방식 저장', text: '고른 방식은 \'집필 방식 저장\'을 눌러야 적용돼요. AI 자율 집필은 저장 전에 세계관 연결과 인물 카드가 필요하다는 확인 창이 떠요.' },
    { target: 'manage-settings-policy', title: '분기 정책', text: '\'분기 정책 편집\'에서 분기 만들기를 허용할지, 분기 작품의 최초 공개를 허용할지 정해요. 둘은 별개예요.' },
  ],
}

type Props = {
  vm: ReturnType<typeof useEpisodeViewModel>
  work: Work
  /** 테스트가 넣는 UseCase. 세계관·설정집이 같은 UseCase를 쓴다. */
  useCase?: EpisodeUseCase
  /** 주소의 `?tab=world`: 가져오기 결과 화면에서 세계관 탭을 바로 연다(서재의 `?tab=`과 같은 방식). */
  initialTab?: 'world'
  onForked: (id: string) => void
  onDeleted: () => void
  /** 사이드바를 펼쳤는지. 접은 동안 돌아가기 링크를 상단 줄로 옮겨 그리는 호출 측(EpisodePage)이 상태를 갖는다. */
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  /** 맨 위 알림(오류·상태). 사이드바 위에 끼면 화면 높이를 쓰는 사이드바가 아래로 밀리므로 내용 열 맨 위에 그린다. */
  notices?: ReactNode
  /** AI 자율 집필이 켜져 있는지(EpisodePage가 읽는다). 켜져 있으면 서버가 1화 외의 원고 쓰기를 막으므로, 공개 회차 탭의 2화부터의 집필실 링크(수정하기)를 잠그고 이유를 알린다. */
  serialLocked?: boolean
  /** 운영 설정의 집필 방식을 저장했을 때(AI 자율 집필을 켜고 껐을 수 있어 호출 측이 서버 값을 다시 읽는다) */
  onSerialSaved?: () => void
}

/**
 * 고른 내 작품의 관리 영역: 왼쪽 사이드바(공용 ManageMenu: 로고·돌아가기 링크·메뉴(개요·회차 목록·세계관 연결과 설정집 요약·이야기 분기·받은 피드백·내 제보·수정 제안·운영 설정·이력)·알림·계정)와 오른쪽 내용 열(맨 위 알림, 그 아래 고른 메뉴의 내용). 히어로(표지·제목·소개)는 맨 앞 '개요' 탭의 내용이고 그 탭이 기본이다.
 * 분기 정책(분기 작품은 포크 정보)과 작품 삭제는 모든 탭 위가 아니라 운영 설정 탭 안에 있다(분기 정책 아래 맨 끝이 삭제): 고른 탭의 내용이 첫 화면 안에서 시작하게.
 * 공용 상단바(Gnb)는 없고 사이드바가 그 역할을 한다. 작품이 바뀌면 호출 측이 key로 새로 만들어 메뉴 선택·분기 입력이 처음 상태로 돌아간다. 메뉴 틀(.ep-manage·.ep-menu·.ep-content)은 shared/episode.css이고 세계관 관리 화면과 함께 쓴다.
 */
export function WorkManagement({ vm, work: w, useCase, initialTab, onForked, onDeleted, menuOpen, onMenuOpenChange, notices, serialLocked = false, onSerialSaved }: Props) {
  const [tab, setTab] = useState<'overview' | 'read' | 'fork' | 'serial' | 'history' | 'world' | 'feedback' | 'reports' | 'settings'>(initialTab ?? 'overview')
  const { check: checkDelete, checking: checkingDelete, warning: deleteWarning, close: closeDelete } = useWorldReleaseCheck(tab === 'settings' ? w.worldStudioId : null)
  // 한 번에 한 영역만 편집한다: 히어로의 작품 정보·표지와 운영 설정 탭의 분기 정책이 이 상태를 나눠 쓴다.
  const [editing, setEditing] = useState<WorkEditing>(null)
  // 내용을 자기가 읽어 오는 탭 패널이 처음 읽기를 마쳤는지(사용법 투어가 그 뒤에 시작한다).
  const [loaded, setLoaded] = useState<Partial<Record<'settings' | 'serial' | 'world' | 'reports' | 'suggestions', boolean>>>({})
  const loadedOf = (key: keyof typeof loaded) => () => setLoaded((now) => (now[key] ? now : { ...now, [key]: true }))
  const [mediaBusy, setMediaBusy] = useState(false)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [buildCheck, setBuildCheck] = useState(0)
  const [forkTitle, setForkTitle] = useState('')
  const [direction, setDirection] = useState('')
  const [at, setAt] = useState(1)
  // 회차 목록은 10개씩 나눠 보인다. page는 목록이 줄어도 paginate가 범위 안으로 보정한다.
  const [page, setPage] = useState(1)
  const lockNote = useId()
  const episodeList = useRef<HTMLOListElement>(null)
  // 탭 내용은 위의 히어로 아래에서 시작한다. 메뉴를 눌러 탭이 바뀐 직후에만(첫 렌더·새로 고침 제외, 단 `?tab=world`로 열면 첫 렌더에 한 번) 렌더가 커밋된 뒤 내용 머리로 스크롤하고, 초점은 누른 버튼에 그대로 둔다(아래 Pager와 같은 이유).
  const tabContent = useRef<HTMLDivElement>(null)
  const picked = useRef(initialTab !== undefined)
  useEffect(() => {
    if (!picked.current) return
    picked.current = false
    tabContent.current?.scrollIntoView?.({ block: 'start' })
  }, [tab])
  const view = paginate(w.episodes, page)
  // 작성 중인 초안: 발행 전이고 초안이 있는 자체 회차. 공개를 중단한 회차(suspended)는 발행본이 없어도 초안이 아니다.
  const drafts = vm.writing?.rows?.filter(e => !e.inherited && !e.publishedVersionId && e.publicationStatus !== 'suspended' && e.hasDraft !== false)
  // 저장 버전 순번은 소유자 회차 조회의 versions 순서다. 그 목록을 아직 읽는 중이면 못 찾은 '미확인'과 구분해 '불러오는 중'으로 보인다.
  const savedVersion = (episode: number, id?: string) => !vm.writing
    ? '저장 버전 불러오는 중'
    : savedVersionLabel(vm.writing.rows?.find(r => r.number === episode)?.versions ?? [], id)
  const locked = vm.busy || mediaBusy
  // 편집 중에는 작품을 다시 읽는 동작(공개 중단·삭제)을 잠가 저장하지 않은 입력이 새 revision의 폼 리셋으로 사라지지 않게 한다.
  const blocked = locked || editing !== null
  // 세계관·설정집 탭으로 옮긴다. 메뉴를 누른 것과 같이 탭 내용 머리로 스크롤하고(아래 effect), 원고로 세계관 만들기 버튼과 운영 설정의 AI 자율 집필 경고가 함께 쓴다.
  const openWorld = () => { picked.current = true; setTab('world') }
  const deleteWork = async (release?: WorldRelease) => {
    closeDelete()
    const deleted = await (release ? vm.deleteWork(release) : vm.deleteWork())
    if (deleted) onDeleted()
  }
  const askDelete = () => void checkDelete(() => void deleteWork())
  const deleteError = vm.origin === 'delete' ? vm.error : ''
  // 서버가 없는 목업 빌드는 서버 수정 제안을 부르지 않는다(InboxPage와 같다). 정적 JSX에 두면 모듈 로드 때 한 번만 평가되므로 렌더 시점 변수로 읽는다.
  const mockup = import.meta.env.MODE === 'mockup'
  // Fork는 세계관이 연결된 원작에서만 만든다(서버도 409로 막는다). 데모 작품은 연결 정보가 없어 막지 않는다.
  const noWorld = !mockup && !w.worldStudioId
  // 공개 회차의 진행 배지와 업로드 안내가 같은 최초 구축 조회를 사용한다.
  const build = useManuscriptBuild(w.id, w.worldStudioId, undefined, { enabled: tab === 'read' && !mockup, refreshKey: buildCheck })
  const buildLabel = !mockup && !build.error ? worldBuildBadge(build.job) : null
  const initialBuildCompleted = !build.error && initialBuildCompletedOn(build.job, w.worldStudioId)
  // 상속 회차가 있으면 '1~2화'처럼 줄여, 그 회차들은 수정할 수 없다고 따로 알린다.
  const inherited = inheritedRangeLabel(w.episodes)
  // 회차별로 갈라진 공개 포크 수(소설 상세와 같은 목록). 불러오는 중이거나 읽지 못하면 undefined라 수를 감춘다(0편으로 채우지 않는다).
  const forkCounts = useEpisodeForkCounts(w.id)
  // 메뉴 탭 이름. 본문의 탭 제목(h2)이 같은 글이라 한곳에 둔다.
  const tabs = [
    ['overview', '개요'],
    ['read', `공개 회차 · ${w.episodes.length}`],
    ['world', '세계관·설정집'],
    ['fork', '이야기 분기'],
    ['serial', 'AI 집필'],
    ['feedback', '받은 피드백'],
    ['reports', '내 제보·수정 제안'],
    ['settings', '운영 설정'],
    ['history', '저장·AI·발행 이력'],
  ] as const
  // 사용법 투어의 탭: 내용을 읽어 오는 탭은 읽기가 끝난 뒤에만 지금 탭으로 알린다(읽기에 실패하면 시작하지 않는다). 운영 설정 패널·피드백 수정 제안은 서버 없는 시연(목업)에 없다.
  const tabReady: Partial<Record<typeof tab, boolean>> = {
    settings: mockup || !!loaded.settings,
    serial: !!loaded.serial,
    world: !!loaded.world,
    feedback: !!loaded.reports && (mockup || !!loaded.suggestions),
  }
  const tourTab = tabReady[tab] === false ? undefined : tab
  // 탭을 옮긴다(탭 내용 머리로 스크롤하고 이력 탭은 이력을 읽기 시작한다).
  const openTab = (value: typeof tabs[number][0]) => {
    picked.current = true
    setTab(value)
    if (value === 'history') void vm.loadHistory()
  }
  // 탭 제목(h2)은 메뉴 탭 이름과 똑같은 글이다: 어느 탭에 있는지 본문에서도 읽힌다. 탭 안의 묶음 제목은 h3다.
  // 헤딩 순서는 어느 탭이든 작품 제목(h1) → 탭 제목(h2) → 묶음 제목(h3)이다: 다른 탭은 위의 요약 머리가 h1이라 탭 내용 맨 앞에 그리고, 작품 제목(h1)이 탭 내용 안(히어로)에 있는 개요는 히어로 다음에 그린다.
  // 개요는 사이드바에서 이미 '개요'가 골라져 있고 바로 아래 지표 구획(h3)이 이름을 말하므로 제목 줄은 화면 밖에 둔다(세계관 관리 개요와 같다. 헤딩 순서는 그대로다).
  const heading = <h2 className={tab === 'overview' ? 'sr-only' : undefined}>{tabs.find(([value]) => value === tab)![1]}</h2>
  return (
    <div className='ep-manage' data-menu={menuOpen ? undefined : 'collapsed'}>
      <ManageMenu name='작품' open={menuOpen} onOpenChange={onMenuOpenChange} back={{ to: '/lib?tab=write', label: '내가 쓰는 소설' }}>
        {/* 사용법 버튼은 돌아가기 링크 아래·메뉴 위에 둔다: 사이드바 본문의 마지막은 메뉴다. */}
        <ScreenTour screen='manage' steps={tour} tabs={tabTours} tab={tourTab} className='btn sm weak tour-side' />
        <nav aria-label='작품 메뉴'>
          {tabs.map(([value, label]) => (
            <button
              key={value}
              data-tour={`manage-${value}`}
              // 요청 중이거나 편집 폼이 열려 있는 동안(작품 정보·표지는 개요 탭, 분기 정책은 운영 설정 탭 안에 있어 탭을 떠나면 입력이 사라진다)에는 다른 탭으로 옮기지 못하게 잠그되, 지금 탭은 두어 방금 누른 버튼에서 키보드 초점이 사라지지 않게 한다(이력 탭은 누르면 곧 요청이 시작된다).
              disabled={(locked || editing !== null) && tab !== value}
              aria-current={tab === value ? 'page' : undefined}
              // 좁은 화면의 메뉴 줄은 줄바꿈이라 잘린 탭이 없다. 세로는 위 effect가 탭 내용 머리로 옮긴다.
              onClick={() => openTab(value)}
            >
              {label}
            </button>
          ))}
        </nav>
      </ManageMenu>
      <div id='ep-content' tabIndex={-1} className='ep-content'>
        {notices}
        {/* 개요 밖 탭 위에는 짧은 작품 요약만 둔다(세계관 관리와 같은 모양). 작품 정보·표지 편집은 개요 탭에서만 한다. */}
        {tab !== 'overview' && <WorkBrief key={`${w.id}-${vm.coverRevision}`} work={w} draftCount={vm.writing ? drafts?.length : null} serialOn={serialLocked} />}
        {/* 탭 내용 묶음: 메뉴를 누르면 이 머리로 스크롤한다. 상단바가 없어 scroll-margin은 위 여백만이다(회차 목록과 같은 값). */}
        <div ref={tabContent} className='ep-tab' style={{ scrollMarginTop: 16 }}>
          {tab !== 'overview' && heading}
          {tab === 'overview' && (
            <WorkOverview
              work={w}
              locked={locked}
              busy={vm.busy}
              coverRevision={vm.coverRevision}
              onMediaBusy={setMediaBusy}
              onSaveInfo={vm.updateWork}
              editing={editing}
              onEditingChange={setEditing}
              serialOn={serialLocked}
            />
          )}
          {/* 히어로 아래 현황: 지표 카드·최근 발행 이력·바로가기(집필실·소설 상세). 이동 잠금은 메뉴와 같은 규칙이다. 탭 제목(h2)은 작품 제목(h1)을 그리는 히어로 다음, 이 현황(h3 구획) 앞이다. */}
          {tab === 'overview' && (
            <>
              {heading}
              <WorkDashboard
                work={w}
                draftCount={vm.writing ? drafts?.length : null}
                forkCounts={forkCounts}
                mockup={mockup}
                disabled={locked || editing !== null}
                useCase={useCase}
              />
            </>
          )}
          {tab === 'settings' && (
            // 설정 카드·분기 정책(포크 정보)·작품 삭제가 한 카드 틀이다: 넓은 화면은 왼쪽에 집필 방식(두 줄)·오른쪽에 자동 처리·설정 변경 이력이고, 그 아래 분기 정책(포크 정보)과 맨 끝 삭제(위험 구역)는 전체 폭이다(episode.css .ep-settings-cards).
            <div className='ep-settings-cards'>
              {/* 운영 설정 API는 서버 없는 시연(목업)에 없다. 분기 정책·포크 정보·작품 삭제는 모두 있으므로 탭은 남긴다. */}
              {!mockup && <WorkSettingsPanel workId={w.id} useCase={useCase} onSaved={onSerialSaved} onOpenWorld={blocked ? undefined : openWorld} onLoaded={loadedOf('settings')} />}
              {w.source
                ? <ForkInfo source={w.source} isPublic={w.visibility === 'public'} blocked={blocked} onStopFork={vm.stopFork} onDeleteWork={askDelete} checkingDelete={checkingDelete} deleteError={deleteError} />
                : (
                  <>
                    <WorkPolicy work={w} locked={locked} editing={editing} onEditingChange={setEditing} onSave={vm.policy} />
                    <WorkDelete blocked={blocked} onDelete={askDelete} checking={checkingDelete} error={deleteError} />
                  </>
                )}
              {deleteWarning && (
                <WorldReleaseWarning
                  known={!!deleteWarning.world}
                  deletion={workDeletePrompt(w)}
                  onPrivate={() => void deleteWork({ makePrivate: { genre: deleteWarning.world?.genre ?? null } })}
                  onKeep={() => void deleteWork({})}
                  onCancel={closeDelete}
                />
              )}
            </div>
          )}
          {tab === 'world' && (
            <>
              {!mockup && <ManuscriptBuildPanel key={w.id} work={w} />}
              <LinkedWorldPanel work={w} busy={locked} onLink={vm.linkWorld} onDetach={vm.detachWorld} error={vm.origin === 'link' ? vm.error : ''} notice={vm.origin === 'link' ? vm.notice : ''} detachError={vm.origin === 'detach' ? vm.error : ''} useCase={useCase} />
              <WorldPanel workId={w.id} useCase={useCase} locked={locked} onMediaBusy={setMediaBusy} linkedWorldId={w.worldStudioId} onLoaded={loadedOf('world')} onDetach={vm.detachWorld} detachError={vm.origin === 'detach' ? vm.error : ''} />
            </>
          )}
          {tab === 'history' && (
            <section className='ep-reading ep-history'>
              <p>저장본은 보존돼요. 이 화면에서는 이력을 읽기만 하고, 복원과 공개는 집필실에서 해요.</p>
              {/* 이력 요청의 진행·실패는 맨 위 알림(탭 머리로 스크롤하면 화면 밖)이 아니라 여기서 알린다. 다른 요청과 섞이지 않게 origin이 history일 때만 보인다. */}
              {vm.origin === 'history' && vm.error && <p className="ep-alert" role="alert">{vm.error}</p>}
              {vm.origin === 'history' && vm.busy && !vm.history && <p role='status'>이력을 불러오고 있어요…</p>}
              {vm.history && (
                <>
                  <HistoryCard title='발행 이력'>
                    {!vm.history.publicationHistory?<p className="ep-alert" role="alert">발행 이력 응답을 확인할 수 없어요.</p>:vm.history.publicationHistory.length?<ol role='list' className='ep-settings-history'>{vm.history.publicationHistory.map((event,i)=><li key={i}>
                      {event.episode}화 · {publicationActionLabel[event.action]} · {savedVersion(event.episode, event.versionId)}{' '}
                      <time dateTime={event.publishedAt}>{kstDateTime(event.publishedAt)}</time>
                    </li>)}</ol>:<p>발행 이력이 없어요.</p>}
                  </HistoryCard>
                  <HistoryCard title='원고 저장본'>
                    {vm.history.versions.length === 0 && (
                      <p>
                        아직 보관된 저장본이 없어요. 원고를 저장하면 버전 이력을 확인할 수 있어요.
                      </p>
                    )}
                    {vm.history.versions.map((v) => <SavedVersion key={v.id} workId={w.id} version={v} label={savedVersion(v.episode, v.id)} />)}
                  </HistoryCard>
                  <HistoryCard title='AI 요청·제안'>
                    {vm.history.proposals.length === 0 && <p>아직 AI 제안이 없어요.</p>}
                    {vm.history.proposals.map((p) => (
                      <article key={p.id}>
                        <h4>
                          {p.model} · {p.status === 'accepted' ? '적용 완료' : '검토 대기'}
                        </h4>
                        <p>{p.prompt ?? '지시문 기록 없음'}</p>
                        {p.baseBody !== undefined && (
                          <details>
                            <summary>요청 당시 원고</summary>
                            <div>{p.baseBody}</div>
                          </details>
                        )}
                        {p.context && (
                          <details>
                            <summary>요청 당시 설정·문맥 근거</summary>
                            <ContextPreview value={p.context} />
                          </details>
                        )}
                        <div>{p.text}</div>
                      </article>
                    ))}
                  </HistoryCard>
                </>
              )}
            </section>
          )}
          {tab === 'read' && (
            <>
              {buildLabel && <div className='ep-notes'><p><span className='chip wait'>{buildLabel}</span></p></div>}
              {/* 원고 편집은 모두 집필실에서 한다: 회차 목록 머리에 집필실로 바로 가는 창구를 둔다(회차가 0개여도 집필실의 새 회차 버튼으로 1화를 만든다). 사이드바에는 같은 버튼을 두지 않는다. 이 탭의 주 행동이라 채운 버튼이다(아래 가져오기 계열은 작은 보조 버튼). */}
              <p className='ep-list-head'><Go to={`/studio/${w.id}`} className='btn pri' data-tour='manage-read-studio'>집필실 열기</Go></p>
              {vm.writing?.error && <p className="ep-alert" role="alert">{vm.writing.error}</p>}
              {/* AI 자율 집필 중에는 1화만 쓴다: 2화부터의 집필실 링크(수정하기)를 잠그고 이유는 여기서 한 번 알린다. */}
              {serialLocked && <div className='ep-notes'><p id={lockNote} role='status'>{SERIAL_LOCK_NOTICE}</p></div>}
              <div className='ep-notes'>
                <p>
                  {w.visibility === 'public'
                    ? '아래 목록은 독자가 볼 수 있는 발행본이에요.'
                    : '아직 독자에게 공개하지 않은 작품이에요.'}
                </p>
                {inherited && <p>{inherited}는 원작에서 이어받은 회차라 수정할 수 없어요.</p>}
              </div>
              {w.episodes.length
                ? (
                  // 소설 상세(/work/:id)의 회차 행(.ep)을 그대로 쓰고, 오른쪽에 자체 회차는 집필실로 가는 '수정하기', 상속 회차는 읽기 전용 칩을 둔다. 본문은 펼치지 않는다.
                  // 10개씩 나눠 보인다. 쪽을 옮기면 이 머리로 스크롤하므로 위의 sticky 상단바(.gnb)가 가리지 않게 scroll-margin을 둔다.
                  <ol ref={episodeList} className='tcard eps ep-list' data-tour='manage-read-list' style={{ scrollMarginTop: 16 }}>
                    {view.items.map((e) => {
                      const forks = forkCounts?.[e.number] ?? 0
                      return (
                        <li key={e.number} className='ep'>
                          <span className='no'>{e.number}</span>
                          <div>
                            <b>{e.title}</b>
                            <div className='d'>
                              {e.body.length.toLocaleString()}자 (공백 포함)
                              {/* 상속 회차는 저장 버전이 없다(원작 기준 원고). 공개 중인 저장 버전만 순번으로 알린다. */}
                              {!e.inherited && <> <i className='sep' /> 공개 중 · {savedVersion(e.number, e.versionId)}</>}
                              {forks > 0 && <> <i className='sep' /> <span title='이 회차에서 갈라진 포크'><Branch /> <span className='sr-only'>이 회차에서 갈라진 포크 </span>{forks}<span className='sr-only'>편</span></span></>}
                            </div>
                          </div>
                          {e.inherited
                            ? <span className='chip'>원작 회차</span>
                            : serialEpisodeLocked(serialLocked, e.number)
                            ? <button type='button' className='btn sm' disabled aria-describedby={lockNote} aria-label={`${e.number}화 ${e.title} 수정하기`}>수정하기</button>
                            : (
                              <Go to={`/studio/${w.id}?ep=${e.number}`} className='btn sm ep-row-link' aria-label={`${e.number}화 ${e.title} 수정하기`}>
                                수정하기
                              </Go>
                            )}
                        </li>
                      )
                    })}
                  </ol>
                )
                : (
                  <div className='ep-empty'>
                    아직 공개한 회차가 없어요.{!drafts?.length && ' 첫 회차를 작성해 보세요.'}
                  </div>
                )}
              {/* 쪽을 옮기면 목록 머리로 스크롤만 한다. 초점은 누른 쪽 버튼에 남아 이어서 옮길 수 있다(scrollIntoView가 없는 jsdom에서는 건너뛴다). */}
              <Pager page={view.page} pages={view.pages} onPage={(next) => { setPage(next); episodeList.current?.scrollIntoView?.({ block: 'start' }) }} />
              {/* 새 회차 집필은 위 머리의 '집필실 열기'(집필실의 새 회차 버튼) 하나로 간다(같은 곳으로 가는 버튼을 본문에 또 두지 않는다). */}
              {!mockup && (
                <div className='ep-list-foot' data-tour='manage-read-import'>
                  {/* 메뉴를 누른 것과 같이 세계관 탭 내용 머리(원고로 세계관 만들기 카드)로 스크롤한다(위 effect). */}
                  <button type='button' className='btn sm' disabled={locked} onClick={openWorld}>원고로 세계관 만들기</button>
                  <button type="button" className="btn sm" disabled={locked} onClick={() => setBulkImportOpen(true)}>회차 파일 일괄 업로드</button>
                </div>
              )}
              {bulkImportOpen && <EpisodeBulkImportSheet
                workId={w.id}
                firstUnsavedEpisode={vm.writing?.rows?.find(e => !e.inherited && e.versions.length === 0)?.number ?? null}
                initialBuildCompleted={initialBuildCompleted}
                onClose={(refresh) => {
                  setBulkImportOpen(false)
                  if (refresh) { void vm.reload(); setBuildCheck((n) => n + 1) }
                }}
              />}
            </>
          )}
          {tab === 'fork' && (
            <section className='ep-fork'>
              <h3>그 순간, 다른 선택을 했다면</h3>
              <p className='ep-lead'>
                선택한 회차까지의 공개 원고를 보존하고, 그 다음 회차부터 새로운 이야기를
                써 내려가세요. 기준 회차의 공개 설정·상태·지식·관계도 함께 이어져요.
              </p>
              {w.source || w.visibility !== 'public' || !w.allowFork
                ? (
                  <div className='ep-empty' data-tour='manage-fork-blocked'>
                    분기를 허용한 공개 원작에서만 시작할 수 있어요. 분기 작품은 다시 분기할 수
                    없어요.<br />분기 정책에서 분기 만들기를 허용하고, 회차는 집필실에서 공개해 주세요.
                  </div>
                )
                : (
                  <form data-tour='manage-fork-form'
                    onSubmit={async (e) => {
                      e.preventDefault()
                      const id = await vm.fork(at, forkTitle, direction)
                      if (id) onForked(id)
                    }}
                  >
                    <label>
                      기준 회차<select
                        value={at}
                        onChange={(e) => setAt(Number(e.target.value))}
                        disabled={locked}
                      >
                        {w.episodes.map((e) => (
                          <option key={e.number} value={e.number}>
                            {e.number}화 · {e.title} · v{e.version}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      분기 작품 제목<input
                        value={forkTitle}
                        onChange={(e) => setForkTitle(e.target.value)}
                        maxLength={120}
                        required
                        disabled={locked}
                      />
                    </label>
                    <label>
                      무엇이 달라지나요? (선택)<textarea
                        value={direction}
                        onChange={(e) => setDirection(e.target.value)}
                        placeholder='주인공이 그 편지를 읽지 않았다면…'
                        maxLength={2000}
                        rows={4}
                        disabled={locked}
                      />
                    </label>
                    {/* 분기를 만들지 못한 사유는 누른 버튼 바로 위에 알린다(화면 맨 위 알림은 이 자리에서 보이지 않는다). */}
                    {vm.origin === 'fork' && vm.error && <div className='ep-alert' role='alert'>{vm.error}</div>}
                    {noWorld && <p id='ep-fork-world-note' className='ep-muted'>{FORK_WORLD_REQUIRED}</p>}
                    <button className='btn pri' disabled={locked || noWorld} aria-describedby={noWorld ? 'ep-fork-world-note' : undefined}>
                      이 회차에서 분기 만들기
                    </button>
                  </form>
                )}
            </section>
          )}
          {/* AI 집필(UC-18)은 서버 기능이라 서버 없는 시연(목업)에서는 지원하지 않는다고만 알린다. */}
          {tab === 'serial' && (mockup ? <p className='ep-empty'>데모에서는 지원하지 않아요.</p> : <AiSerialPanel workId={w.id} onOpenSettings={blocked ? undefined : () => openTab('settings')} onLoaded={loadedOf('serial')} />)}
          {tab === 'reports' && (
            // 내가 남긴 제보·수정 제안과 데모 피드백(계정 메뉴의 /content?view=reports 화면과 같은 내용). 탭 제목(h2)이 이미 있어 쪽 제목(h1)은 빼고(embedded), 틀은 받은 피드백 탭(.ep-feedback)과 같다.
            <div className='ep-feedback'><MyCommentsReports embedded /></div>
          )}
          {tab === 'feedback' && (
            // 독자가 이 작품에 보낸 문장 제보·수정 제안. 작가 피드백함(/inbox)의 View를 그대로 쓰고, 서버에 workId로 이 작품 것만 묻는다.
            <div className='ep-feedback'>
              <FeedbackReportInbox workId={w.id} onLoaded={loadedOf('reports')} />
              {!mockup && <EditSuggestionInbox workId={w.id} onLoaded={loadedOf('suggestions')} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 이력 탭의 한 묶음(발행 이력·원고 저장본·AI 요청·제안): 제목(h3)이 이름인 카드 구획이다(세계관·설정집 탭의 카드와 같은 `tcard ep-card`). */
function HistoryCard({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className='tcard ep-card' aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  )
}

/**
 * 이력 탭의 저장 버전 한 건. 제목과 저장 시각만 먼저 보이고 본문은 '원고 보기'로 펼칠 때 그린다.
 * 저장본이 쌓여도 모든 본문과 그 안의 이미지를 한꺼번에 그리거나 내려받지 않는다.
 * 제목·시각은 왼쪽, '원고 보기' 버튼은 오른쪽 끝이고 펼친 원고는 전체 폭 새 줄이다(`.ep-version` 격자, episode.css).
 */
function SavedVersion({ workId, version: v, label }: { workId: string; version: Version; label: string }) {
  const [open, setOpen] = useState(false)
  const title = useId()
  return (
    <article className='ep-version'>
      <h4 id={title}>{v.episode}화 · {label} · {v.title}</h4>
      <p><time dateTime={v.savedAt}>{kstDateTime(v.savedAt)}</time></p>
      <p>
        <button type='button' className='btn sm' aria-expanded={open} aria-describedby={title} onClick={() => setOpen((shown) => !shown)}>
          {open ? '원고 접기' : '원고 보기'}
        </button>
      </p>
      {open && <ManuscriptBody workId={workId} number={v.episode} body={v.body} />}
    </article>
  )
}

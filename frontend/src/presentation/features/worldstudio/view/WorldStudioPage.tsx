import '../../../shared/episode.css'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { relationLabel } from '../../../../domain/entities/studioRelations'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import { cardLibraryRows, writingIssueLabel } from '../../../../domain/entities/worldStudioWriting'
import { coverSrc } from '../../../shared/cover'
import { Go } from '../../../shared/Go'
import { McpChangeBanner } from '../../../shared/McpChangeBanner'
import { PageControls } from '../../../shared/PageControls'
import { pageItems } from '../../../shared/pageItems'
import { BackChev } from '../../../shared/icons'
import { useScreenId } from '../../../shared/screenIds'
import { Sheet } from '../../../shared/Sheet'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { ManageMenu } from '../../../shared/shell/ManageMenu'
import { ScreenTour, type TourStep } from '../../../shared/tour/ScreenTour'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useMcpChangeWatch } from '../../../shared/useMcpChangeWatch'
import { labelOf } from '../viewmodel/settingBoard'
import { useCardCategories } from '../../../shared/useCardCategories'
import { useWorldRevisions } from '../viewmodel/useWorldRevisions'
import { UNLISTED_HINT } from '../viewmodel/worldPublication'
import { MANAGE_VIEWS, type StudioStep } from '../viewmodel/worldStudioFlow'
import { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { CardCategoryNotice } from './CardCategoryNotice'
import { InitialWorldReview } from './InitialWorldReview'
import { WorldAiReview } from './WorldAiReview'
import { WorldInfoPanel, WorldOverviewMetrics } from './WorldInfoPanel'
import { WorldCardBoard } from './WorldCardBoard'
import { WorldCardStudio } from './WorldCardStudio'
import { useWorldChatPage } from '../viewmodel/useWorldChatPage'
import { WorldChat } from './WorldChat'
import { WorldCreate } from './WorldCreate'
import { WorldLinkedLine, WorldNovelButton, WorldNovelTab } from './WorldLinkedWork'
import { GenreChip, PublicCardsNotice, PublishFields } from './WorldPublishFields'
import { RelationEpisodePicker } from './RelationEpisodePicker'
import { WorldRelationshipEditor } from './WorldRelationshipEditor'
import { WorldRevisions } from './WorldRevisions'
import { WorldSaveBar } from './WorldSaveBar'
import { WorldTimeline } from './WorldTimeline'
import { ReaderPreviewLink, WorldExportButton } from './WorldHeaderExtras'
import { useLinkedWorkBasis } from '../viewmodel/useLinkedWorkBasis'
import './world-studio.css'

type VM = ReturnType<typeof useWorldStudioViewModel>
// 사용법 투어(#971)의 화면 투어(첫 진입 1회, 메뉴 소개): 관리 모드 사이드바의 보기 버튼(data-tour="world-<보기>")과 도구 버튼으로 무엇을 하는 곳인지 한 문장씩 알린다. 접힌 사이드바의 대상은 보이지 않아 단계에서 빠진다. 사용법 버튼은 이것이 아니라 지금 보기의 투어를 연다.
const tour: TourStep[] = [
  { target: 'world-overview', title: '개요', text: '세계관 이름·설명·공개 설정·표지를 고치고 현황을 봐요. 표지는 AI로 만들 수도 있어요.' },
  { target: 'world-book', title: '설정집', text: '설정 카드를 만들고 분류해요. 소설을 연결한 세계관은 카드마다 몇 화부터 공개할지 정해요.' },
  { target: 'world-people', title: '관계도', text: '설정 사이의 관계를 한 그래프에서 보고 만들어요. 관계는 회차별로 기록돼요.' },
  { target: 'world-timeline', title: '시간선', text: '승인한 사건 카드를 회차 순서로 가로 시간축에 놓아 보여요.' },
  { target: 'world-novel', title: '소설 연결', text: '이 세계관을 소설 하나와 1:1로 연결해요. 연결된 소설과 그 Fork 소설도 여기서 봐요.' },
  { target: 'world-review', title: 'AI 검토', text: 'AI는 검토와 제안만 하고, 설정에 반영하는 건 내가 해요.' },
  { target: 'world-versions', title: '확정 버전', text: '독자에게는 확정한 버전만 보여요. 저장하지 않은 변경이 있으면 먼저 저장해야 해요. 다른 보기도 처음 열면 안내가 나오고, 사용법 버튼으로 다시 볼 수 있어요.' },
]

// 보기별 사용법 투어(#971): 보기(탭)에 처음 들어갈 때(화면 투어 다음) 그 보기의 우리만의 기능과 쓰는 법을 짚는다. 대상은 data-tour="world-<보기>-<이름>"이고, 사용법 버튼은 지금 보기의 투어를 연다.
// 소설을 연결하지 않은 세계관의 공개 범위 일괄 변경·갈라진 Fork가 없는 소설 연결처럼 화면에 없는 대상의 단계는 빠진다.
const tabTours: Record<string, TourStep[]> = {
  overview: [
    { target: 'world-overview-publish', title: '공개 설정', text: '세계관을 공개·비공개로 정하고 장르를 골라요. 공개 화면에는 확정 버전의 공개 설정만, 연결한 소설이 발행한 회차까지 보여요. 저장해야 적용돼요.' },
    { target: 'world-overview-cover', title: '표지', text: "표지는 '이미지 선택'으로 올리거나 'AI로 생성'으로 만들어요. 생성한 결과는 '이 이미지 선택'을 누른 뒤 '저장'해야 표지가 돼요." },
  ],
  book: [
    { target: 'world-book-tools', title: '새 설정 만들기', text: "'+ 새 설정'에서 인물·장소·사건 같은 유형을 고르면 새 카드의 편집 화면이 열려요. '다른 세계관에서 가져오기'로 카드를 복사해 올 수도 있어요." },
    { target: 'world-book-list', title: '설정 목록', text: "줄을 누르면 미리보기가 열리고, '수정하기'로 카드 작성 화면(문서·개요·관계·버전·공개 순서)을 열어요." },
    { target: 'world-book-bulk', title: '공개 범위 한 번에 바꾸기', text: "카드를 골라 일괄 공개 회차(N화부터)를 넣고 '선택 공개'를, 숨기려면 '선택 비공개'를 눌러요. 소설을 연결한 세계관에서만 보이고, 저장한 뒤 확정 버전을 남겨야 독자에게 반영돼요." },
  ],
  people: [
    { target: 'world-people-episode', title: '관계 기준 회차', text: "관계는 '시작 회차'와 함께 기록돼요. 회차를 넣고 '이 회차 관계 보기'를 누르면 그 회차 시점의 관계가 보이고, '최신으로'로 돌아와요." },
    { target: 'world-people-canvas', title: '전체 관계도', text: '설정 카드와 관계가 한 그래프에 모두 보여요. 노드를 누르면 그 설정과 이웃이 강조되고, 더블클릭하면 그 설정의 편집 화면이 열려요.' },
    // 바로 앞 단계와 같은 대상이면 joyride가 말풍선을 다시 띄우지 않아(불투명도 0) 캔버스 아래 조작 안내 줄을 짚는다.
    { target: 'world-people-hint', title: '그래프에서 만들기', text: "빈 곳이나 노드를 오른쪽 클릭하면 메뉴가 열려요(터치는 길게 누르기). 빈 곳은 '여기에 설정 추가', 노드는 '관계 연결'을 골라 상대 노드를 누르면 관계 작성 시트가 열려요." },
    { target: 'world-people-add', title: '+ 설정 추가', text: "왼쪽 위 '+ 설정 추가'로도 새 설정을 캔버스에 바로 더해요." },
    { target: 'world-people-settings', title: '그래프 설정', text: '톱니 버튼에서 화면 맞춤·배치 정돈, 설정 찾기와 유형·관계 종류 필터, 중심 보기를 써요.' },
  ],
  timeline: [
    { target: 'world-timeline-board', title: '사건 시간선', text: '승인한 사건 카드가 회차 순서로 가로 시간축에 놓여요. 방향키(←→↑↓)로 사건 사이를 오가고 Enter로 고르면 내용과 관련 설정이 보여요.' },
  ],
  novel: [
    { target: 'world-novel-link', title: '소설 연결', text: "세계관은 소설 하나에만 연결돼요. '소설 연결하기'로 내 소설을 고르고, 연결한 뒤에는 '소설 작성하기'로 그 작품 관리로 가요." },
    { target: 'world-novel-forks', title: 'Fork 소설', text: '연결한 소설에서 갈라진 공개 Fork 소설을 모아 봐요. 회차를 하나 이상 발행한 공개 Fork만 보여요.' },
  ],
}
const steps = [['info', '기본 정보'], ['cards', '설정 카드'], ['relations', '관계 연결 (선택)'], ['review', '검토·저장']] as const

/**
 * 세계관 관리·작성 화면. 두 화면이다.
 * - **설정집 화면**(기본): `/content` 작품 관리와 같은 틀이지만 공용 상단바(Gnb)는 그리지 않는다 — 왼쪽 사이드바(`.ep-menu`)가 상단바 역할을 맡고 오른쪽에 내용 열(`.ep-content`)이 있다. 사이드바는 위에서 아래로
 *   맨 위 줄(STORYFORK 로고 + 접기 토글), 서재로 돌아가는 링크, 보기 메뉴(개요·설정집·관계도·시간선·소설 연결, 주소 `?view=`, 기본은 설정집), 구분선 뒤 아래쪽으로 밀어 붙인 `AI 검토`(시트: 설정집 검토 + AI 후보 검토, 이름에 의견·후보 수가 붙는다)·`확정 버전 남기기`·상시 저장 영역,
 *   맨 아래 줄(알림·계정 아바타, 테마는 계정 메뉴의 `다크 모드` 항목)이다. 검색 버튼은 두지 않는다(Ctrl K 전역 단축키). 901px 이상에서는 맨 위 토글로 사이드바를 접을 수 있고 접으면 토글만 남고 서재로 돌아가는 링크와 저장 영역이 상단 줄(`.ep-top`)로 옮겨 간다(두 곳 동시 노출 없음).
 *   내용 열에는 공개 세계관 상세와 같은 모양의 헤더(표지·이름·칩·소개)와 그 아래 고른 보기의 내용(기본은 설정집 게시판, 개요는 세계관 지표 띠와 그 아래 정보 편집 폼(구획 카드), 소설 연결은 연결된 소설과 Fork)이 있다.
 *   관계도 보기(`?view=people`)는 세계관 머리를 그리지 않고(이름은 화면 밖 h1, '관계 입력 미적용' 칩만 남는다) React Flow 캔버스가 내용 열 전체 폭 × 화면의 남은 높이를 채운다(관계는 캔버스에서 바로 만들고 그 아래에는 폼·표가 없다, `CharacterCards`, `world-studio.css`). 관리 모드에는 푸터도 없다.
 *   만든 직후(`?new=1`)는 작성 모드(사이드바 없이 기본 정보 → 설정 카드 → 관계 연결 → 검토·저장 4단계 마법사)다. 사이드바가 없는 작성 모드와 세계관 없는 만들기 화면은 공용 상단바(Gnb)와 푸터가 그대로다.
 * - **편집 화면**(`?card=<id>`): 설정 카드를 열면(게시판 행의 미리보기 `수정하기`) 집필실과 같은 3단 화면(`WorldCardStudio`: 카드 목록·버전 그래프 레일 / 편집기 / AI 채팅)이 이 화면을 대신하고, `← {들어온 보기 이름}`·뒤로가기로 돌아온다.
 * 설정집 화면은 편집 화면 뒤에서 지우지 않고 숨겨 두어 필터·적용하지 않은 관계 입력·후보 검토 상태를 지킨다. 주소 `/worldstudio`(세계관 없음)에서만 새 세계관 만들기 화면을 그린다.
 * 소설 작성은 실행 모드의 작품 생성 화면에서 시작한다.
 * 세계관이 열린 화면(주소에 id가 있는 경로)은 떠 있는 테마 버튼(GlobalChrome)을 그리지 않는다(집필실과 같은 규칙, 열린 채팅의 전송 버튼을 덮지 않게).
 * 테마 전환은 공용 상단바(Gnb)가 있는 작성 모드·세계관 없는 만들기 화면에서는 상단바 계정 메뉴의 `다크 모드` 항목이 맡고(세계관 없는 만들기 화면의 떠 있는 버튼은 CSS가 숨긴다), 상단바가 없는 설정집 화면은 사이드바 계정 메뉴의 같은 항목, 편집 화면은 `WorldCardStudio` 상단 바의 버튼이다.
 * 관리 주소는 세계관을 읽는 동안·읽지 못했을 때도 상단바를 그리지 않는다(사이드바가 나타날 때 상단바가 사라지며 화면이 밀리지 않게, 그 사이의 뒤로 가기 링크는 상단 줄에 있다).
 */
export function WorldStudioPage() {
  useScreenId('W01')
  useDocumentTitle('세계관')
  const vm = useWorldStudioViewModel()
  // AI·외부 도구(MCP)가 이 세계관을 바꾸면 알림 신호로 알아차려 다시 읽는다. 저장하지 않은 변경·관계 입력이 있으면 덮지 않고 배너로 알린다(#553).
  const mcp = useMcpChangeWatch({ targetType: 'world', targetId: vm.reviewWorldId, dirty: vm.dirty || vm.relationDirty, reload: vm.refresh })
  // 넓은 화면은 채팅을 연 채로, 1200px 이하는 닫은 채로 시작한다. 전송이 아직 잠긴(준비 중) 채팅이 300~350px를 차지하면 중간 폭에서 게시판·편집기가 너무 좁아지기 때문이다.
  // 닫혀 있어도 `AI 채팅 열기`로 열 수 있고(900px 이하에서는 화면을 덮는 서랍), 설정집 화면과 편집 화면이 같은 상태를 쓴다.
  const [chatOpen, setChatOpen] = useState(() => !window.matchMedia?.('(max-width: 1200px)').matches)
  const chatPage = useWorldChatPage(vm)
  const loading = !!vm.reviewWorldId && !vm.editing && !vm.error
  // 세계관을 열지 못한 상태(편집 중 저장 실패와 달리 편집 내용이 없어, 다시 읽어도 잃는 입력이 없다).
  const failed = !!vm.reviewWorldId && !vm.editing && !!vm.error
  const editingCard = !!vm.editing && !!vm.selected
  // 확정 버전 목록·남기기는 설정집 화면의 `확정 버전 남기기`와 편집 화면의 버전 그래프가 같은 훅·같은 시트를 쓴다(공개 목록에 나오려면 확정 버전이 필요하다).
  const revisions = useWorldRevisions(vm.reviewWorldId, !!vm.editing, vm.saved, vm.dirty || vm.relationDirty, vm.reload, vm.setReviewBusy)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const closeVersions = () => setVersionsOpen(false)
  // 사이드바 접기(901px 이상): 접은 동안 서재로 돌아가는 링크와 상시 저장 영역은 상단 줄로 옮겨 그린다. 상단 줄이 이 페이지에 있어 접힘 상태도 여기서 가진다.
  // ponytail: 접힘 상태를 저장하지 않는다(새로 고치면 펼침). 필요하면 worldStudioStorage에 한 키로 남긴다.
  const [menuOpen, setMenuOpen] = useState(true)
  // 900px 이하의 닫힌 AI 채팅 열기 버튼이 들어갈 자리(사이드바 탭 줄의 오른쪽 끝). 탭 줄이 그려지면 채워져 WorldChat이 그 안으로 버튼을 옮긴다.
  const [chatSlot, setChatSlot] = useState<HTMLElement | null>(null)
  // 게시판 미리보기의 `수정하기`로 연 카드(편집기를 미리보기 탭으로 시작한다). 편집 화면을 나가면 비운다.
  const [previewEntry, setPreviewEntry] = useState('')
  useEffect(() => { if (!editingCard) setPreviewEntry('') }, [editingCard])
  // 관리 모드(주소에 세계관 id, 작성 모드 아님)는 공용 상단바(Gnb) 대신 사이드바가 그 역할을 맡는다. 읽는 동안·읽지 못했을 때도 같다: 사이드바가 나타날 때 상단바가 사라지며 화면이 밀리지 않게.
  const sidebarShell = !!vm.reviewWorldId && vm.mode === 'manage'
  // 사이드바를 펼친 동안은 서재로 돌아가는 링크가 사이드바에 있어 상단 줄(.ep-top)을 그리지 않는다(두 곳 동시 노출 없음). 사이드바가 없거나(작성 모드·만들기·읽는 중·읽지 못함) 접힌 동안만 그린다.
  const sideMenu = sidebarShell && !!vm.editing && menuOpen
  // 오류·상태·AI 변경 알림은 세계관이 열려 있으면 내용 열(WorldEditor) 맨 위에 그린다: 사이드바 위에 끼면 화면 높이를 다 쓰는 사이드바가 그만큼 아래로 밀려 맨 아래 줄(계정)이 화면 밖으로 잘린다(상태 알림은 다음 동작까지 남는다).
  // 편집 화면이 열려 있는 동안은 같은 오류·알림을 그 화면이 보인다(숨은 설정집 화면에 같은 글이 겹쳐 있지 않게 한다).
  const alertLine = !editingCard && vm.error && <p role="alert" className="ep-alert">{vm.error}</p>
  const statusLine = !editingCard && vm.message && <p role="status" className="ep-notice">{vm.message}</p>
  const changeBanner = !editingCard && <McpChangeBanner {...mcp} />
  return (
    <>
      {!editingCard && !sidebarShell && <Gnb on="lib" />}
      <div className={'episode-app' + (vm.editing && chatOpen ? ' with-chat' : '')} hidden={editingCard}>
        <main id={editingCard ? undefined : 'main'} tabIndex={-1} className="ep-main world-studio world-writing">
          {!sideMenu && (
            <div className="ep-top">
              <Go to="/lib?tab=worlds" className="ep-back"><BackChev />내가 만드는 세계관</Go>
              {vm.editing && vm.mode === 'manage' && !menuOpen && !editingCard && <WorldSaveBar vm={vm} />}
            </div>
          )}
          {!vm.editing && alertLine}
          {failed && (
            <div className="ep-card-actions">
              <button type="button" className="btn sm" disabled={vm.busy} onClick={vm.retryLoad}>다시 시도</button>
              <Go to="/lib?tab=worlds" className="btn sm">내가 만드는 세계관으로 돌아가기</Go>
            </div>
          )}
          {!vm.editing && statusLine}
          {!vm.editing && changeBanner}
          {loading && <p role="status" className="ep-notice">세계관을 불러오고 있어요…</p>}
          {!vm.reviewWorldId && <WorldCreate vm={vm} />}
          {!vm.editing && vm.reviewWorldId && <InitialWorldReview key={vm.reviewWorldId} studio={vm} />}
          {vm.editing && <WorldEditor vm={vm} world={vm.editing} revisions={revisions} openVersions={() => setVersionsOpen(true)} menuOpen={menuOpen} setMenuOpen={setMenuOpen} chatSlotRef={setChatSlot} onPreviewEdit={setPreviewEntry} notices={<>{alertLine}{statusLine}{changeBanner}</>} />}
        </main>
        {/* 편집 화면이 열려 있는 동안은 그 화면이 채팅을 그린다. 숨은 설정집 화면의 채팅은 좁은 화면에서 body에 그려지는 서랍이라 여기서 빼지 않으면 편집 화면 위에 겹쳐 뜬다. */}
        {vm.editing && !editingCard && <WorldChat open={chatOpen} onOpenChange={setChatOpen} slot={chatSlot} linkedWorkId={vm.linkedWorkId} onWorldApplied={() => void vm.aiDraftChanged()} {...chatPage} />}
      </div>
      {editingCard && <WorldCardStudio vm={vm} mcp={mcp} revisions={revisions} openVersions={() => setVersionsOpen(true)} chatOpen={chatOpen} onChatOpenChange={setChatOpen} previewFirst={previewEntry === vm.selected} />}
      {vm.editing && versionsOpen && (
        <Sheet sid="W01" label="확정 버전" panelClass="sheet world-sheet" onClose={closeVersions}>
          <div className="world-sheet-head"><button type="button" className="btn sm" onClick={closeVersions}>닫기</button></div>
          <WorldRevisions studio={vm} revisions={revisions} />
        </Sheet>
      )}
      {!editingCard && !sidebarShell && <Footer />}
    </>
  )
}

/**
 * 공개 세계관 상세 헤더와 같은 모양: 표지(올린 표지가 있으면 그 이미지, 없으면 기본 표지), 이름, 칩(설정 수·저장 버전·공개 범위·장르·저장 상태), 소개. 이름·소개·수는 저장한 세계관 기준이다.
 * 관리 모드의 이름·설명·공개 범위·장르·표지 편집은 헤더가 아니라 '개요' 탭(`WorldInfoPanel`)에서 하고, 연결된 소설 상태 줄·소설 버튼도 '소설 연결' 탭으로 옮겼다. 관리 모드 헤더에는 보기(탭)와 상관없이 보일 것만 남는다:
 * 표지·이름·칩·소개(CSS가 모든 보기에서 72px 표지 + 제목·칩 한 덩어리로 줄이며 소개는 숨긴다: 소개 전문은 개요 탭의 입력에 있다)·공개 목록 안내와 공개 화면 링크·공개 설정 경고. 저장 상태는 왼쪽 사이드바(접으면 상단 줄)의 저장 영역이 보인다.
 * 헤더에는 공개 범위·장르 칩만 있고, 공개 목록에 나올 때(공개 + 확정 버전)만 공개 화면 링크가, 공개인데 확정 버전이 없을 때는 그 안내가 보인다.
 * 공개 세계관인데 공개로 둔 설정이 없으면 그 경고와 `전체 공개`를 보인다(어느 탭에서든 보여야 한다).
 * 작성 모드(만든 직후의 마법사)도 같은 줄어든 히어로다(`data-view="wizard"`): 행동 줄에 소설 버튼 한 자리(연결된 소설이 있으면 그 작품 관리로 가는 `소설 작성하기`, 없으면 `소설 연결하기`, 데모는 새 소설 폼으로 가는 `소설 작성하기`)와 `관리 화면으로`가 있고
 * 그 위에 연결된 소설 상태 줄(정보만)이 있다. 이름·설명·공개 설정은 기본 정보 단계에 있고 저장 상태는 헤더 칩이 보이며 '관리 화면으로'로 나갈 수 있다. 테마 전환 버튼은 이 화면 안에 두지 않고 공용 상단바(Gnb)의 계정 메뉴가 맡는다.
 */
function WorldHeader({ vm, world }: { vm: VM; world: StudioWorld }) {
  const saved = vm.saved ?? world
  const manage = vm.mode === 'manage'
  const basis = useLinkedWorkBasis(vm.linkedWorkId) // 독자 시점 미리보기의 N화: 연결된 소설의 가장 뒤 발행 회차
  const { visibility, genre } = vm.publication
  const state = vm.saveState === 'saving' ? { tone: 'wait', text: '저장 중' }
    : vm.saveState === 'failed' ? { tone: 'wait', text: '저장 실패 · 입력은 유지돼요' }
    : vm.dirty ? { tone: 'wait', text: '작성 중 · 미저장' }
    : { tone: 'ok', text: '저장됨' }
  const title = useRef<HTMLHeadingElement>(null)
  const wasManage = useRef(manage)
  // 처음 저장해 관리 모드로 바뀌면 헤더 제목으로 초점을 옮긴다(바뀐 화면의 맨 위에서 이어 읽게).
  useEffect(() => {
    if (manage && !wasManage.current) title.current?.focus()
    wasManage.current = manage
  }, [manage])
  return (
    <section className="whero ep-hero world-manage-hero" data-view={manage ? vm.view : 'wizard'}>
      <div className="ep-hero-cover">
        <div className="cov"><img src={coverSrc(vm.cover.url)} alt={vm.cover.url ? '세계관 표지' : '기본 세계관 표지'} /></div>
      </div>
      <div className="ep-hero-main">
        <div className="ep-title-row">
          <h1 ref={title} tabIndex={-1}>{saved.name || '이름 없는 세계관'}</h1>
        </div>
        <div className="ep-chips">
          <span className="chip">설정 {cardLibraryRows(saved.settings, 'all', '').length}개</span>
          <span className="chip">저장 버전 {saved.version.toLocaleString('ko-KR')}개</span>
          <span className={'chip' + (visibility === 'public' ? ' ok' : '')}>{visibility === 'public' ? '공개' : '비공개'}</span>
          {genre && <GenreChip code={genre} />}
          {!manage && <span role="status" className={'chip ' + state.tone}>{state.text}</span>}
          {vm.relationDirty && <span role="status" className="chip wait">관계 입력 미적용</span>}
        </div>
        {saved.description
          ? <p className="sum">{saved.description}</p>
          : <p className="sum ep-muted">{manage ? '개요에서 세계관 소개를 적어 보세요.' : '기본 정보에서 세계관 소개를 적어 보세요.'}</p>}
        {import.meta.env.MODE === 'mockup' && <p className="small muted">{vm.storage.intro}</p>}
        {vm.listing === 'unlisted' && <p role="status" className="small muted">{UNLISTED_HINT}</p>}
        {manage && <PublicCardsNotice vm={vm} visibility={visibility} />}
        {!manage && <WorldLinkedLine vm={vm} />}
        <div className="acts">
          {!manage && <WorldNovelButton vm={vm} />}
          {vm.publicHref && <Go to={vm.publicHref} className="btn sm">공개 화면 보기</Go>}
          <ReaderPreviewLink workId={vm.linkedWorkId} episode={basis?.episode ?? null} />
          <WorldExportButton world={saved} dirty={vm.dirty || vm.relationDirty} />
          {!manage && <button type="button" className="btn sm" onClick={vm.leaveWizard}>관리 화면으로</button>}
        </div>
      </div>
    </section>
  )
}

/**
 * 작성 모드 기본 정보 단계의 세계관 단위 공개 범위·장르. 초안 저장과 별개로 바꾸는 즉시 적용된다(공개로 바꿀 때만 한 번 확인). 전송 중에는 잠그고, 실패하면 이전 값 그대로 오류 문구를 보인다.
 * 설정 카드 단위 공개와는 다르다. 관리 모드는 개요 탭의 정보 편집 폼에서 저장과 함께 적용한다.
 */
function WorldPublish({ vm }: { vm: VM }) {
  return (
    <fieldset className="world-publish world-compact" disabled={vm.busy}>
      <legend className="sr-only">공개 설정</legend>
      <PublishFields value={vm.publishing ?? vm.publication} onChange={vm.setPublication} />
      <p className="small muted">바로 적용돼요. 공개 화면에는 확정 버전의 공개 설정만, 소설이 발행한 회차까지 보여요.</p>
      <PublicCardsNotice vm={vm} visibility={(vm.publishing ?? vm.publication).visibility} />
    </fieldset>
  )
}

/**
 * 작성 모드(세계관을 처음 만든 직후, 주소 `?new=1`)는 사이드바 없이 기본 정보부터 4단계 마법사다. 그 밖의 모든 진입은 관리 모드로, `/content` 작품 관리처럼
 * 왼쪽 사이드바(공용 틀 `.ep-manage`·`.ep-menu`·`.ep-content`, shared/episode.css)가 공용 상단바(Gnb)를 대신하고 공용 `ManageMenu`(shared/shell)가 그린다. 맨 위 줄은 STORYFORK 로고 + 접기 토글이고 그 아래 서재로 돌아가는 링크와 보기 메뉴(개요·설정집·관계도·시간선·소설 연결, 주소 `?view=`, 기본은 설정집)로 화면을 바꾸며,
 * 구분선 뒤 아래쪽으로 밀어 붙인 `AI 검토`(시트)·`확정 버전 남기기`와 상시 저장 영역(도구 묶음 `.ep-menu-tools`), 맨 아래 줄(`.ep-menu-account`)에 알림·계정이 있다(테마는 계정 메뉴의 `다크 모드` 항목).
 * 내용 열 맨 위에는 오류·상태·AI 변경 알림(`notices`)이 있다(사이드바 위에 끼어 사이드바를 아래로 밀지 않게 페이지의 위쪽이 아니라 여기에 그린다).
 * 보기마다 내용 열은 그 보기의 내용만 보인다: 개요(작품 관리 개요 같은 세계관 지표 띠 `WorldOverviewMetrics` + 이름·설명·공개·장르·표지 편집 구획 카드 `WorldInfoPanel`, `.ep-dash`)·설정집(게시판)·관계도·시간선·소설 연결(연결된 소설과 Fork, `WorldNovelTab`).
 * 게시판·관계 편집기·(한 번 연) 개요 폼은 다른 보기에서도 숨겨 둘 뿐 지우지 않아 필터·선택·적용하지 않은 관계 입력·쓰던 이름과 고른 표지가 남고, 소설 연결은 볼 때만 그린다.
 * 900px 이하에서는 사이드바가 내용 위의 가로 블록이 되어 로고 줄(로고 + 계정 줄)이 맨 위에 오고 그 아래 메뉴·도구가 줄바꿈하는 가로 줄이다. 901px 이상에서는 맨 위 토글(`세계관 메뉴 접기`)로 사이드바를 접어 내용 열을 넓힌다:
 * 접으면 토글만 남고(로고·계정 줄은 CSS가 숨긴다) 메뉴 묶음은 숨길 뿐 지우지 않으며(AI 검토 상태가 남는다) 서재로 돌아가는 링크와 저장 영역만 상단 줄로 옮겨 그린다(`WorldStudioPage`, 두 군데 동시에 뜨지 않는다).
 * 메뉴를 누르면 누른 버튼을 가로 줄 안에 보이게 하고 바뀐 내용 카드 머리로 스크롤한다(처음 열 때·같은 메뉴를 다시 누를 때는 하지 않고, 초점은 누른 버튼에 둔다).
 * 확정 버전은 편집 화면의 버전 그래프에서 남기고 본다. 시간선은 저장한 설정의 사건만 보인다.
 */
function WorldEditor({ vm, world, revisions, openVersions, menuOpen, setMenuOpen, chatSlotRef, onPreviewEdit, notices }: { vm: VM; world: StudioWorld; revisions: ReturnType<typeof useWorldRevisions>; openVersions: () => void; menuOpen: boolean; setMenuOpen: (open: boolean) => void; chatSlotRef: (slot: HTMLElement | null) => void; onPreviewEdit: (id: string) => void; notices: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const manage = vm.mode === 'manage'
  // 작성 모드는 마법사 단계이고, 관리 모드는 보기가 곧 화면이라 관계도이면 관계 화면, 그 밖은 설정 카드 쪽이다(게시판은 설정집일 때만 보인다).
  const view = manage ? vm.view : null
  const step: StudioStep = manage ? (view === 'people' ? 'relations' : 'cards') : vm.flow.step
  const timeline = view === 'timeline'
  // 개요 폼은 한 번 열면 숨길 뿐 지우지 않아(게시판·관계 편집기와 같다) 다른 보기에 다녀와도 쓰던 이름·설명·고른 표지가 남는다. 열기 전에는 그리지 않는다(장르 목록 같은 읽기를 미리 하지 않는다).
  const [overviewSeen, setOverviewSeen] = useState(false)
  if (view === 'overview' && !overviewSeen) setOverviewSeen(true)
  const current = steps.findIndex(([id]) => id === step)
  useEffect(() => { if (vm.flow.screen === 'editor') heading.current?.focus({ preventScroll: true }) }, [step, vm.flow.screen])
  // 탭 내용은 히어로 아래에서 시작해 메뉴를 눌러도 바뀐 것이 안 보일 수 있다(/content 작품 관리와 같다). 메뉴를 눌러 보기가 바뀐 직후에만 내용 카드 머리로 스크롤한다.
  const card = useRef<HTMLElement>(null)
  const picked = useRef(false)
  useEffect(() => {
    if (!picked.current) return
    picked.current = false
    card.current?.scrollIntoView?.({ block: 'start' })
  }, [vm.view])
  return (
    <section className={'world-content' + (manage ? ' ep-manage' : '')} data-menu={manage && !menuOpen ? 'collapsed' : undefined} hidden={vm.flow.screen !== 'editor'} aria-busy={vm.busy}>
      {manage && (
        <ManageMenu
          name="세계관"
          open={menuOpen}
          onOpenChange={setMenuOpen}
          back={{ to: '/lib?tab=worlds', label: '내가 만드는 세계관' }}
          tools={(
            <>
              <WorldAiReview studio={vm} />
              <VersionsButton vm={vm} supported={revisions.supported} open={openVersions} />
              {!vm.selected && menuOpen && <WorldSaveBar vm={vm} />}
            </>
          )}
        >
          {/* 첫 렌더는 목록 단계라 이 구역이 hidden이다: 편집 화면이 보일 때 시작해야 대상이 잡힌다(jsdom은 checkVisibility가 없어 브라우저에서만 재현). */}
          <ScreenTour screen="world" steps={tour} tabs={tabTours} tab={vm.view} ready={vm.flow.screen === 'editor'} className="btn sm weak tour-side" />
          <div className="world-menu-row">
            <nav aria-label="세계관 메뉴">
              {MANAGE_VIEWS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  data-tour={`world-${id}`}
                  aria-current={vm.view === id ? 'page' : undefined}
                  onClick={(e) => {
                    // 900px 이하의 가로 스크롤 줄에서 가장자리에 잘린 메뉴를 눌러도 그 버튼이 줄 안에 다 보이게 옆으로만 옮긴다(세로는 위 effect가 내용 카드 머리로 옮긴다).
                    e.currentTarget.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
                    picked.current = id !== vm.view
                    vm.setView(id)
                  }}
                >{label}</button>
              ))}
            </nav>
            <div className="world-chat-slot" ref={chatSlotRef} />
          </div>
        </ManageMenu>
      )}
      <div id="ep-content" tabIndex={-1} className="ep-content" data-view={manage ? view : undefined}>
        {notices}
        {manage && view === 'people'
          // 관계도 보기는 캔버스가 내용 열을 채우도록 세계관 머리(표지·이름·칩 줄)를 그리지 않는다. 이름은 화면 밖 h1로만 남겨 화면 구조(h1 하나)를 지키고, 머리의 칩이 알리던 '관계 입력 미적용'은 이 보기의 맨 위에 따로 둔다(적용하지 않은 관계 입력이 있다는 신호가 사라지지 않게).
          ? <><h1 className="sr-only">{(vm.saved ?? world).name || '이름 없는 세계관'}</h1>{vm.relationDirty && <span role="status" className="chip wait">관계 입력 미적용</span>}</>
          : <WorldHeader vm={vm} world={world} />}
        {!manage && (
          <nav className="world-step-nav" aria-label="세계관 작성 단계">
            <ol>
              {steps.map(([id, label], i) => (
                <li key={id} data-state={i < current ? 'done' : i === current ? 'now' : 'next'}>
                  <button type="button" aria-current={step === id ? 'step' : undefined} onClick={() => vm.goStep(id)}><span aria-hidden="true">{i + 1}</span>{label}</button>
                </li>
              ))}
            </ol>
          </nav>
        )}
        {/* 탭 내용 묶음: 메뉴를 누르면 이 머리로 스크롤한다(관리 모드뿐). scroll-margin은 머리 위 여백 16px이다: 상단바가 없어 /content 작품 관리의 80px(상단바 64px + 여백 16px)에서 상단바 몫을 뺀다. */}
        <section ref={card} className="tcard ep-card" style={{ scrollMarginTop: 16 }}>
          {!manage && <h3 className="world-step-title" ref={heading} tabIndex={-1}>{steps[current][1]}</h3>}
          {!manage && (
            <fieldset className="world-fields world-basic" disabled={vm.busy} hidden={step !== 'info'}>
              <legend className="sr-only">세계관 기본 정보</legend>
              <label className="field">세계관 이름<input className="inp" required value={world.name} maxLength={100} onChange={(e) => vm.patch({ name: e.target.value })} /></label>
              <label className="field">세계관 설명<textarea className="ta world-natural-input" rows={6} value={world.description} maxLength={20000} placeholder="어떤 시대와 배경에서 시작하나요? 정해 둔 세계의 모습을 자유롭게 적어 주세요." onChange={(e) => vm.patch({ description: e.target.value })} /></label>
              <p className="small muted">이름만 정해도 시작할 수 있어요. 자세한 설정은 나중에 추가하세요.</p>
              <WorldPublish vm={vm} />
            </fieldset>
          )}
          {(overviewSeen || view === 'overview') && (
            <div className="ep-dash" hidden={view !== 'overview'}>
              {/* 메뉴 탭 이름과 같은 글이라 화면에는 그리지 않는다(작품 관리 탭 본문의 h2와 같다): 제목 단계가 h1 → h3로 건너뛰지 않게. */}
              <h2 className="sr-only">개요</h2>
              <WorldOverviewMetrics vm={vm} world={vm.saved ?? world} revisions={revisions} />
              <WorldInfoPanel key={vm.relationKey} vm={vm} world={vm.saved ?? world} />
            </div>
          )}
          {view === 'novel' && <WorldNovelTab vm={vm} />}
          <div hidden={manage ? view !== 'book' : step !== 'cards'}><WorldCardBoard vm={vm} onPreviewEdit={onPreviewEdit} /></div>
          {timeline && (
            <section className="world-confirmed" aria-label="시간선" data-tour="world-timeline-board">
              <h3>저장된 시간선</h3>
              <WorldTimeline settings={vm.saved?.settings ?? []} onOpenCard={vm.editCard} />
            </section>
          )}
          {vm.relationWorld === world.id && (
            <div hidden={step !== 'relations'}>
              {!manage && <button className="btn sm" type="button" onClick={vm.returnToCard}>설정 카드로 돌아가기</button>}
              <RelationEpisodePicker studio={vm} />
              <WorldRelationshipEditor key={`${world.id}:${vm.relationKey}`} studio={vm} />
            </div>
          )}
          {!manage && step === 'review' && <WritingReview vm={vm} />}
          {!manage && (
            <nav className="world-step-actions" aria-label="단계 이동">
              {current > 0 && <button className="btn" type="button" onClick={() => vm.goStep(steps[current - 1][0])}>이전 단계</button>}
              {current < steps.length - 1 && <button className="btn pri" type="button" onClick={() => vm.goStep(steps[current + 1][0])}>{step === 'relations' ? '검토·저장으로' : '다음 단계'}</button>}
              {step === 'cards' && <button className="btn" type="button" onClick={() => vm.goStep('review')}>관계 없이 검토·저장</button>}
            </nav>
          )}
        </section>
      </div>
    </section>
  )
}

/**
 * 설정집 화면의 `확정 버전 남기기`: 편집 화면 버전 그래프의 같은 이름 버튼처럼 확정 버전 시트(기존 확정 요청·복구 UI)를 연다. 공개 목록에 나오려면 확정 버전이 필요해 게시판에서도 남길 수 있게 사이드바의 저장 영역 위에 둔다.
 * 저장하지 않은 변경이 있으면 기존 규칙대로(확정은 저장된 초안만) 잠그고 이유를 알린다. 목업은 확정 버전을 지원하지 않는다.
 */
function VersionsButton({ vm, supported, open }: { vm: VM; supported: boolean; open: () => void }) {
  const reason = useId()
  const why = !supported ? '목업에서는 확정 버전을 지원하지 않아요.' : vm.dirty || vm.relationDirty ? '저장하지 않은 변경이 있어요. 먼저 세계관을 저장하세요.' : vm.sealIssues[0]?.message ?? ''
  return (
    <>
      <button type="button" className="btn sm" data-tour="world-versions" aria-haspopup="dialog" disabled={!!why} aria-describedby={why ? reason : undefined} onClick={open}>확정 버전 남기기</button>
      {why && <span id={reason} className="small muted">{why}</span>}
    </>
  )
}

function WritingReview({vm}:{vm:VM}){
 const {categories,isError,retry}=useCardCategories()
 const world=vm.editing!,cards=world.settings.filter(s=>s.item.kind!=='relation'),relations=world.settings.filter(s=>s.item.kind==='relation')
 const [cardPage,setCardPage]=useState(0),[relationPage,setRelationPage]=useState(0),[issuePage,setIssuePage]=useState(0)
 const shownCards=pageItems(cards,cardPage,50),shownRelations=pageItems(relations,relationPage,50),shownIssues=pageItems(vm.writingIssues,issuePage,50)
 const names=new Map(world.settings.map(s=>[s.item.id,s.item.title])),name=(id:string|null)=>(id&&names.get(id))||'이름 없는 설정'
 const editInfo=()=>vm.goStep('info')
 return <section className="world-review" aria-label="세계관 검토"><article className="world-review-intro"><div className="world-toolbar"><h4>{world.name||'이름 없는 세계관'}</h4><button className="btn sm" type="button" onClick={editInfo}>기본 정보 수정</button></div><p className="world-prose">{world.description||'설명은 나중에 추가해도 괜찮아요.'}</p></article><CardCategoryNotice isError={isError} retry={retry}/>
  {vm.writingIssues.length>0&&<div className="world-error" role="alert"><h4>저장 전에 확인해 주세요</h4><ul>{shownIssues.items.map((issue,i)=><li key={i}><button type="button" onClick={()=>vm.openIssue(issue)}>{writingIssueLabel(world,issue)}</button></li>)}</ul><PageControls page={shownIssues.page} pages={shownIssues.pages} onPage={setIssuePage} /></div>}
  <h4>설정 카드 {cards.length}개</h4>{cards.length?shownCards.items.map(s=><article className="world-review-item" key={s.item.id}><div><span className="small muted">{labelOf(s,categories)}</span><h5>{s.item.title||'이름 없는 설정'}</h5><p className="world-prose">{s.item.text||'설명 없음'}</p></div><button className="btn sm" type="button" aria-label={`${s.item.title||'이름 없는 설정'} 수정`} onClick={()=>vm.editCard(s.item.id)}>수정</button></article>):<p className="muted">아직 등록한 설정이 없어요. 기본 정보만 저장해도 괜찮아요.</p>}<PageControls page={shownCards.page} pages={shownCards.pages} onPage={setCardPage} />
  <h4>관계 {relations.length}개</h4>{relations.length?shownRelations.items.map(s=><article key={s.item.id} className="world-review-item"><div><h5>{name(s.item.subjectId)} → {name(s.item.targetId)}</h5><p className="world-prose">{relationLabel(s.item)}</p></div><button className="btn sm" type="button" onClick={()=>vm.editRelation(s.item.id)}>관계 수정</button></article>):<p className="muted">관계는 선택 사항이에요. 나중에 연결할 수 있어요.</p>}<PageControls page={shownRelations.page} pages={shownRelations.pages} onPage={setRelationPage} />
  <div className="world-save-actions"><p className="small muted">저장은 발행·공개와 달라요.</p>{vm.episodeSaveNote&&<p className="small muted">{vm.episodeSaveNote}</p>}<button className="btn pri" type="button" disabled={!vm.canSave} onClick={vm.save}>세계관 저장</button></div>
 </section>
}

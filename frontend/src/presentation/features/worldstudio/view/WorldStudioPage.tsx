import '../../../shared/episode.css'
import { useEffect, useId, useRef, useState } from 'react'

import { relationLabel } from '../../../../domain/entities/studioRelations'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import { cardLibraryRows, writingIssueLabel } from '../../../../domain/entities/worldStudioWriting'
import { coverSrc } from '../../../shared/cover'
import { Go } from '../../../shared/Go'
import { McpChangeBanner } from '../../../shared/McpChangeBanner'
import { PageControls } from '../../../shared/PageControls'
import { pageItems } from '../../../shared/pageItems'
import { BackChev, FoldIcon } from '../../../shared/icons'
import { useScreenId } from '../../../shared/screenIds'
import { Sheet } from '../../../shared/Sheet'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useMcpChangeWatch } from '../../../shared/useMcpChangeWatch'
import { labelOf } from '../viewmodel/settingBoard'
import { useWorldRevisions } from '../viewmodel/useWorldRevisions'
import { UNLISTED_HINT } from '../viewmodel/worldPublication'
import { MANAGE_VIEWS, type StudioStep } from '../viewmodel/worldStudioFlow'
import { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { InitialWorldReview } from './InitialWorldReview'
import { WorldAiReview } from './WorldAiReview'
import { WorldInfoPanel } from './WorldInfoPanel'
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
import './world-studio.css'

type VM = ReturnType<typeof useWorldStudioViewModel>
/** `집필 메모 추가`: 새 메모를 초안에 더하고 그 편집 화면을 연다. 관리 모드는 왼쪽 사이드바의 `AI 검토` 아래에, 사이드바가 없는 작성 모드(마법사)는 헤더 행동 줄에 둔다. */
const NoteButton = ({ vm }: { vm: VM }) => <button type="button" className="btn sm" onClick={() => { const id = vm.addCard('note'); if (id) vm.editCard(id) }}>집필 메모 추가</button>
const steps = [['info', '기본 정보'], ['cards', '설정 카드'], ['relations', '관계 연결 (선택)'], ['review', '검토·저장']] as const

/**
 * 세계관 관리·작성 화면. 두 화면이다.
 * - **설정집 화면**(기본): `/content` 작품 관리와 같은 틀 — 공용 상단바 아래 서재로 돌아가는 링크, 그 아래 왼쪽 사이드바(`.ep-menu`)와 오른쪽 내용 열(`.ep-content`). 사이드바에는 보기 메뉴(개요·설정집·관계도·시간선·소설 연결, 주소 `?view=`, 기본은 설정집)와 구분선 뒤에
 *   `AI 검토`(시트: 설정집 검토 + AI 후보 검토, 이름에 의견·후보 수가 붙는다)·`집필 메모 추가`·`확정 버전 남기기`·상시 저장 영역이 세로로 있고(901px 이상에서는 맨 위 토글로 사이드바를 접을 수 있고 접으면 저장 영역이 상단 줄로 옮겨 간다), 내용 열에는 공개 세계관 상세와 같은 모양의 헤더(표지·이름·칩·소개)와 그 아래 고른 보기의 내용(기본은 설정집 게시판, 개요는 정보 편집 폼, 소설 연결은 연결된 소설과 Fork)이 있다.
 *   만든 직후(`?new=1`)는 작성 모드(사이드바 없이 기본 정보 → 설정 카드 → 관계 연결 → 검토·저장 4단계 마법사)다.
 * - **편집 화면**(`?card=<id>`): 설정 카드를 열면(게시판 행의 미리보기 `수정하기`) 집필실과 같은 3단 화면(`WorldCardStudio`: 카드 목록·버전 그래프 레일 / 편집기 / AI 채팅)이 이 화면을 대신하고, `← {들어온 보기 이름}`·뒤로가기로 돌아온다.
 * 설정집 화면은 편집 화면 뒤에서 지우지 않고 숨겨 두어 필터·적용하지 않은 관계 입력·후보 검토 상태를 지킨다. 주소 `/worldstudio`(세계관 없음)에서만 새 세계관 만들기 화면을 그린다.
 * 소설 작성은 실행 모드의 작품 생성 화면에서 시작한다.
 * 세계관이 열린 화면(주소에 id가 있는 경로)은 떠 있는 테마 버튼(GlobalChrome)을 그리지 않는다(집필실과 같은 규칙, 열린 채팅의 전송 버튼을 덮지 않게).
 * 공용 상단바(Gnb)가 있는 설정집 화면·작성 모드·세계관 없는 만들기 화면은 테마 버튼을 화면 안에 따로 두지 않고 상단바의 것 하나가 맡으며(세계관 없는 만들기 화면의 떠 있는 버튼은 CSS가 숨긴다), 상단바가 없는 편집 화면은 `WorldCardStudio` 상단 바에 있다.
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
  // 사이드바 접기(901px 이상): 접은 동안 상시 저장 영역은 상단 줄(뒤로 가기 링크 오른쪽)로 옮겨 그린다. 상단 줄이 이 페이지에 있어 접힘 상태도 여기서 가진다.
  // ponytail: 접힘 상태를 저장하지 않는다(새로 고치면 펼침). 필요하면 worldStudioStorage에 한 키로 남긴다.
  const [menuOpen, setMenuOpen] = useState(true)
  // 900px 이하의 닫힌 AI 채팅 열기 버튼이 들어갈 자리(사이드바 탭 줄의 오른쪽 끝). 탭 줄이 그려지면 채워져 WorldChat이 그 안으로 버튼을 옮긴다.
  const [chatSlot, setChatSlot] = useState<HTMLElement | null>(null)
  // 게시판 미리보기의 `수정하기`로 연 카드(편집기를 미리보기 탭으로 시작한다). 편집 화면을 나가면 비운다.
  const [previewEntry, setPreviewEntry] = useState('')
  useEffect(() => { if (!editingCard) setPreviewEntry('') }, [editingCard])
  return (
    <>
      {!editingCard && <Gnb on="lib" />}
      <div className={'episode-app' + (vm.editing && chatOpen ? ' with-chat' : '')} hidden={editingCard}>
        <main id={editingCard ? undefined : 'main'} tabIndex={-1} className="ep-main world-studio world-writing">
          <div className="ep-top">
            <Go to="/lib?tab=worlds" className="ep-back"><BackChev />내가 만드는 세계관</Go>
            {vm.editing && vm.mode === 'manage' && !menuOpen && !editingCard && <WorldSaveBar vm={vm} />}
          </div>
          {/* 편집 화면이 열려 있는 동안은 같은 오류·알림을 그 화면이 보인다(숨은 설정집 화면에 같은 글이 겹쳐 있지 않게 한다). */}
          {!editingCard && vm.error && <p role="alert" className="ep-alert">{vm.error}</p>}
          {failed && (
            <div className="ep-card-actions">
              <button type="button" className="btn sm" disabled={vm.busy} onClick={vm.retryLoad}>다시 시도</button>
              <Go to="/lib?tab=worlds" className="btn sm">내가 만드는 세계관으로 돌아가기</Go>
            </div>
          )}
          {!editingCard && vm.message && <p role="status" className="ep-notice">{vm.message}</p>}
          {!editingCard && <McpChangeBanner {...mcp} />}
          {loading && <p role="status" className="ep-notice">세계관을 불러오고 있어요…</p>}
          {!vm.reviewWorldId && <WorldCreate vm={vm} />}
          {!vm.editing && vm.reviewWorldId && <InitialWorldReview key={vm.reviewWorldId} studio={vm} />}
          {vm.editing && <WorldEditor vm={vm} world={vm.editing} revisions={revisions} openVersions={() => setVersionsOpen(true)} menuOpen={menuOpen} setMenuOpen={setMenuOpen} chatSlotRef={setChatSlot} onPreviewEdit={setPreviewEntry} />}
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
      {!editingCard && <Footer />}
    </>
  )
}

/**
 * 공개 세계관 상세 헤더와 같은 모양: 표지(올린 표지가 있으면 그 이미지, 없으면 기본 표지), 이름, 칩(설정 수·저장 버전·공개 범위·장르·저장 상태), 소개. 이름·소개·수는 저장한 세계관 기준이다.
 * 관리 모드의 이름·설명·공개 범위·장르·표지 편집은 헤더가 아니라 '개요' 탭(`WorldInfoPanel`)에서 하고, 연결된 소설 상태 줄·소설 버튼도 '소설 연결' 탭으로 옮겼다. 관리 모드 헤더에는 보기(탭)와 상관없이 보일 것만 남는다:
 * 표지·이름·칩·소개(CSS가 모든 보기에서 72px 표지 + 제목·칩 한 덩어리로 줄이며 소개는 숨긴다: 소개 전문은 개요 탭의 입력에 있다)·공개 목록 안내와 공개 화면 링크·공개 설정 경고. 저장 상태는 왼쪽 사이드바(접으면 상단 줄)의 저장 영역이 보인다.
 * 헤더에는 공개 범위·장르 칩만 있고, 공개 목록에 나올 때(공개 + 확정 버전)만 공개 화면 링크가, 공개인데 확정 버전이 없을 때는 그 안내가 보인다.
 * 공개 세계관인데 공개로 둔 설정이 없으면 그 경고와 `전체 공개`를 보인다(어느 탭에서든 보여야 한다).
 * 작성 모드(만든 직후의 마법사)도 같은 줄어든 히어로다(`data-view="wizard"`): 행동 줄에 `집필 메모 추가`(설정 카드 단계에서만)·소설 버튼 한 자리(연결된 소설이 있으면 그 작품 관리로 가는 `소설 작성하기`, 없으면 `소설 연결하기`, 데모는 새 소설 폼으로 가는 `소설 작성하기`)와 `관리 화면으로`가 있고
 * 그 위에 연결된 소설 상태 줄(정보만)이 있다. 이름·설명·공개 설정은 기본 정보 단계에 있고 저장 상태는 헤더 칩이 보이며 '관리 화면으로'로 나갈 수 있다. 테마 전환 버튼은 이 화면 안에 두지 않고 공용 상단바(Gnb)가 맡는다.
 */
function WorldHeader({ vm, world }: { vm: VM; world: StudioWorld }) {
  const saved = vm.saved ?? world
  const manage = vm.mode === 'manage'
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
          <span className="chip">저장 버전 {saved.version}</span>
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
        {(!manage || vm.publicHref) && (
          <div className="acts">
            {!manage && vm.flow.step === 'cards' && <NoteButton vm={vm} />}
            {!manage && <WorldNovelButton vm={vm} />}
            {vm.publicHref && <Go to={vm.publicHref} className="btn sm">공개 화면 보기</Go>}
            {!manage && <button type="button" className="btn sm" onClick={vm.leaveWizard}>관리 화면으로</button>}
          </div>
        )}
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
 * 왼쪽 사이드바(공용 틀 `.ep-manage`·`.ep-menu`·`.ep-content`, shared/episode.css)의 보기 메뉴(개요·설정집·관계도·시간선·소설 연결, 주소 `?view=`, 기본은 설정집)로 화면을 바꾸고, 그 아래 구분선 뒤에 `AI 검토`(시트)·`집필 메모 추가`·`확정 버전 남기기`와 상시 저장 영역을 세로로 둔다.
 * 보기마다 내용 열은 그 보기의 내용만 보인다: 개요(이름·설명·공개·장르·표지 편집, `WorldInfoPanel`)·설정집(게시판)·관계도·시간선·소설 연결(연결된 소설과 Fork, `WorldNovelTab`).
 * 게시판·관계 편집기·(한 번 연) 개요 폼은 다른 보기에서도 숨겨 둘 뿐 지우지 않아 필터·선택·적용하지 않은 관계 입력·쓰던 이름과 고른 표지가 남고, 소설 연결은 볼 때만 그린다.
 * 900px 이하에서는 사이드바가 내용 위의 가로 스크롤 줄이 되고 버튼·저장 영역은 줄바꿈하는 가로 줄이다. 901px 이상에서는 맨 위 토글(`세계관 메뉴 접기`)로 사이드바를 접어 내용 열을 넓힌다:
 * 접어도 메뉴 묶음은 숨길 뿐 지우지 않고(AI 검토 상태가 남는다) 저장 영역만 상단 줄로 옮겨 그린다(`WorldStudioPage`, 두 군데 동시에 뜨지 않는다).
 * 메뉴를 누르면 누른 버튼을 가로 줄 안에 보이게 하고 바뀐 내용 카드 머리로 스크롤한다(처음 열 때·같은 메뉴를 다시 누를 때는 하지 않고, 초점은 누른 버튼에 둔다).
 * 확정 버전은 편집 화면의 버전 그래프에서 남기고 본다. 시간선은 저장한 설정의 사건만 보인다.
 */
function WorldEditor({ vm, world, revisions, openVersions, menuOpen, setMenuOpen, chatSlotRef, onPreviewEdit }: { vm: VM; world: StudioWorld; revisions: ReturnType<typeof useWorldRevisions>; openVersions: () => void; menuOpen: boolean; setMenuOpen: (open: boolean) => void; chatSlotRef: (slot: HTMLElement | null) => void; onPreviewEdit: (id: string) => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const menuId = useId()
  const manage = vm.mode === 'manage'
  // 작성 모드는 마법사 단계이고, 관리 모드는 보기가 곧 화면이라 관계도이면 관계 화면, 그 밖은 설정 카드 쪽이다(게시판은 설정집일 때만 보인다).
  const view = manage ? vm.view : null
  const step: StudioStep = manage ? (view === 'people' ? 'relations' : 'cards') : vm.flow.step
  const timeline = view === 'timeline'
  const toggleLabel = menuOpen ? '세계관 메뉴 접기' : '세계관 메뉴 펼치기' // 아이콘만 있는 버튼: 이름(aria-label)과 마우스 툴팁(title)이 같은 글이다
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
        <div className="ep-menu">
          <button type="button" className="world-menu-toggle" aria-expanded={menuOpen} aria-controls={menuId} aria-label={toggleLabel} title={toggleLabel} onClick={() => setMenuOpen(!menuOpen)}><FoldIcon /></button>
          <div id={menuId} className="world-menu-body" hidden={!menuOpen}>
            <div className="world-menu-row">
            <nav aria-label="세계관 메뉴">
              {MANAGE_VIEWS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
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
            <div className="world-menu-tools">
              <WorldAiReview studio={vm} />
              <NoteButton vm={vm} />
              <VersionsButton vm={vm} supported={revisions.supported} open={openVersions} />
              {!vm.selected && menuOpen && <WorldSaveBar vm={vm} />}
            </div>
          </div>
        </div>
      )}
      <div className="ep-content">
        <WorldHeader vm={vm} world={world} />
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
        {/* 탭 내용 묶음: 메뉴를 누르면 이 머리로 스크롤한다. scroll-margin은 sticky 상단바(.gnb)가 머리를 가리지 않게(/content 작품 관리와 같은 값). */}
        <section ref={card} className="tcard ep-card" style={{ scrollMarginTop: 80 }}>
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
          {(overviewSeen || view === 'overview') && <div hidden={view !== 'overview'}><WorldInfoPanel key={vm.relationKey} vm={vm} world={vm.saved ?? world} /></div>}
          {view === 'novel' && <WorldNovelTab vm={vm} />}
          <div hidden={manage ? view !== 'book' : step !== 'cards'}><WorldCardBoard vm={vm} onPreviewEdit={onPreviewEdit} /></div>
          {timeline && (
            <section className="world-confirmed" aria-label="시간선">
              <h3>저장된 시간선</h3>
              <WorldTimeline items={vm.saved?.settings.map((s) => s.item) ?? []} />
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
      <button type="button" className="btn sm" aria-haspopup="dialog" disabled={!!why} aria-describedby={why ? reason : undefined} onClick={open}>확정 버전 남기기</button>
      {why && <span id={reason} className="small muted">{why}</span>}
    </>
  )
}

function WritingReview({vm}:{vm:VM}){
 const world=vm.editing!,cards=world.settings.filter(s=>s.item.kind!=='relation'),relations=world.settings.filter(s=>s.item.kind==='relation')
 const [cardPage,setCardPage]=useState(0),[relationPage,setRelationPage]=useState(0),[issuePage,setIssuePage]=useState(0)
 const shownCards=pageItems(cards,cardPage,50),shownRelations=pageItems(relations,relationPage,50),shownIssues=pageItems(vm.writingIssues,issuePage,50)
 const names=new Map(world.settings.map(s=>[s.item.id,s.item.title])),name=(id:string|null)=>(id&&names.get(id))||'이름 없는 설정'
 const editInfo=()=>vm.goStep('info')
 return <section className="world-review" aria-label="세계관 검토"><article className="world-review-intro"><div className="world-toolbar"><h4>{world.name||'이름 없는 세계관'}</h4><button className="btn sm" type="button" onClick={editInfo}>기본 정보 수정</button></div><p className="world-prose">{world.description||'설명은 나중에 추가해도 괜찮아요.'}</p></article>
  {vm.writingIssues.length>0&&<div className="world-error" role="alert"><h4>저장 전에 확인해 주세요</h4><ul>{shownIssues.items.map((issue,i)=><li key={i}><button type="button" onClick={()=>vm.openIssue(issue)}>{writingIssueLabel(world,issue)}</button></li>)}</ul><PageControls page={shownIssues.page} pages={shownIssues.pages} onPage={setIssuePage} /></div>}
  <h4>설정 카드 {cards.length}개</h4>{cards.length?shownCards.items.map(s=><article className="world-review-item" key={s.item.id}><div><span className="small muted">{labelOf(s)}</span><h5>{s.item.title||'이름 없는 설정'}</h5><p className="world-prose">{s.item.text||'설명 없음'}</p></div><button className="btn sm" type="button" aria-label={`${s.item.title||'이름 없는 설정'} 수정`} onClick={()=>vm.editCard(s.item.id)}>수정</button></article>):<p className="muted">아직 등록한 설정이 없어요. 기본 정보만 저장해도 괜찮아요.</p>}<PageControls page={shownCards.page} pages={shownCards.pages} onPage={setCardPage} />
  <h4>관계 {relations.length}개</h4>{relations.length?shownRelations.items.map(s=><article key={s.item.id} className="world-review-item"><div><h5>{name(s.item.subjectId)} → {name(s.item.targetId)}</h5><p className="world-prose">{relationLabel(s.item)}</p></div><button className="btn sm" type="button" onClick={()=>vm.editRelation(s.item.id)}>관계 수정</button></article>):<p className="muted">관계는 선택 사항이에요. 나중에 연결할 수 있어요.</p>}<PageControls page={shownRelations.page} pages={shownRelations.pages} onPage={setRelationPage} />
  <div className="world-save-actions"><p className="small muted">저장은 발행·공개와 달라요.</p>{vm.episodeSaveNote&&<p className="small muted">{vm.episodeSaveNote}</p>}<button className="btn pri" type="button" disabled={!vm.canSave} onClick={vm.save}>세계관 저장</button></div>
 </section>
}

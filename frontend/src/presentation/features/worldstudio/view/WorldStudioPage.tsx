import '../../../shared/episode.css'
import { useEffect, useId, useRef, useState } from 'react'

import { relationLabel } from '../../../../domain/entities/studioRelations'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import type { Theme } from '../../../../domain/entities/work'
import { cardLibraryRows, writingIssueLabel } from '../../../../domain/entities/worldStudioWriting'
import { Art } from '../../../shared/art'
import { rng } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { useScreenId } from '../../../shared/screenIds'
import { Sheet } from '../../../shared/Sheet'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { genreLabel } from '../../../shared/worldGenres'
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
import { WorldChat } from './WorldChat'
import { WorldCreate } from './WorldCreate'
import { WorldLinkedLine, WorldNovelButton } from './WorldLinkedWork'
import { PublicCardsNotice, PublishFields } from './WorldPublishFields'
import { RelationEpisodePicker } from './RelationEpisodePicker'
import { WorldRelationshipEditor } from './WorldRelationshipEditor'
import { WorldRevisions } from './WorldRevisions'
import { WorldSaveBar } from './WorldSaveBar'
import { WorldTimeline } from './WorldTimeline'
import './world-studio.css'

type VM = ReturnType<typeof useWorldStudioViewModel>
/** `집필 메모 추가`: 새 메모를 초안에 더하고 그 편집 화면을 연다. 관리 모드는 보기 전환 줄의 `AI 후보 검토` 옆에, 그 줄이 없는 작성 모드(마법사)는 헤더 행동 줄에 둔다. */
const NoteButton = ({ vm }: { vm: VM }) => <button type="button" className="btn sm" onClick={() => { const id = vm.addCard('note'); if (id) vm.editCard(id) }}>집필 메모 추가</button>
const steps = [['info', '기본 정보'], ['cards', '설정 카드'], ['relations', '관계 연결 (선택)'], ['review', '검토·저장']] as const
const themes: Theme[] = ['hanji', 'star', 'neon']

/**
 * 세계관 관리·작성 화면. 두 화면이다.
 * - **설정집 화면**(기본): `/content` 작품 관리와 같은 틀 — 공용 상단바 아래 서재로 돌아가는 링크, 공개 세계관 상세와 같은 모양의 헤더(표지·이름·칩·소개), 보기 전환 줄(설정집·인물 관계도·시간선, 주소 `?view=`)과
 *   오른쪽의 `AI 후보 검토 (대기 N)`(시트)·상시 저장 영역, 그 아래 설정집 게시판. 만든 직후(`?new=1`)는 작성 모드(보기 줄 없이 기본 정보 → 설정 카드 → 관계 연결 → 검토·저장 4단계 마법사)다.
 * - **편집 화면**(`?card=<id>`): 설정 카드를 열면 집필실과 같은 3단 화면(`WorldCardStudio`: 카드 목록·버전 그래프 레일 / 편집기 / AI 채팅)이 이 화면을 대신하고, `← 설정집`·뒤로가기로 돌아온다.
 * 설정집 화면은 편집 화면 뒤에서 지우지 않고 숨겨 두어 필터·적용하지 않은 관계 입력·후보 검토 상태를 지킨다. 주소 `/worldstudio`(세계관 없음)에서만 새 세계관 만들기 화면을 그린다.
 * 소설 작성은 실행 모드의 작품 생성 화면에서 시작한다.
 */
export function WorldStudioPage() {
  useScreenId('W01')
  useDocumentTitle('세계관')
  const vm = useWorldStudioViewModel()
  // 넓은 화면은 채팅을 연 채로, 1200px 이하는 닫은 채로 시작한다. 전송이 아직 잠긴(준비 중) 채팅이 300~350px를 차지하면 중간 폭에서 게시판·편집기가 너무 좁아지기 때문이다.
  // 닫혀 있어도 `AI 채팅 열기`로 열 수 있고(900px 이하에서는 화면을 덮는 서랍), 설정집 화면과 편집 화면이 같은 상태를 쓴다.
  const [chatOpen, setChatOpen] = useState(() => !window.matchMedia?.('(max-width: 1200px)').matches)
  const loading = !!vm.reviewWorldId && !vm.editing && !vm.error
  const editingCard = !!vm.editing && !!vm.selected
  // 확정 버전 목록·남기기는 설정집 화면의 `확정 버전 남기기`와 편집 화면의 버전 그래프가 같은 훅·같은 시트를 쓴다(공개 목록에 나오려면 확정 버전이 필요하다).
  const revisions = useWorldRevisions(vm.reviewWorldId, !!vm.editing, vm.saved, vm.dirty || vm.relationDirty, vm.reload, vm.setReviewBusy)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const closeVersions = () => setVersionsOpen(false)
  return (
    <>
      {!editingCard && <Gnb on="lib" />}
      <div className={'episode-app' + (vm.editing && chatOpen ? ' with-chat' : '')} hidden={editingCard}>
        <main id={editingCard ? undefined : 'main'} tabIndex={-1} className="ep-main world-studio world-writing">
          <div className="ep-top">
            <Go to="/lib?tab=worlds" className="ep-back"><BackChev />내가 만드는 세계관</Go>
          </div>
          {/* 편집 화면이 열려 있는 동안은 같은 오류·알림을 그 화면이 보인다(숨은 설정집 화면에 같은 글이 겹쳐 있지 않게 한다). */}
          {!editingCard && vm.error && <p role="alert" className="ep-alert">{vm.error}</p>}
          {!editingCard && vm.message && <p role="status" className="ep-notice">{vm.message}</p>}
          {loading && <p role="status" className="ep-notice">세계관을 불러오고 있어요…</p>}
          {!vm.reviewWorldId && <WorldCreate vm={vm} />}
          {!vm.editing && vm.reviewWorldId && <InitialWorldReview key={vm.reviewWorldId} studio={vm} />}
          {vm.editing && <WorldEditor vm={vm} world={vm.editing} revisions={revisions} openVersions={() => setVersionsOpen(true)} />}
        </main>
        {/* 편집 화면이 열려 있는 동안은 그 화면이 채팅을 그린다. 숨은 설정집 화면의 채팅은 좁은 화면에서 body에 그려지는 서랍이라 여기서 빼지 않으면 편집 화면 위에 겹쳐 뜬다. */}
        {vm.editing && !editingCard && <WorldChat open={chatOpen} onOpenChange={setChatOpen} />}
      </div>
      {editingCard && <WorldCardStudio vm={vm} revisions={revisions} openVersions={() => setVersionsOpen(true)} chatOpen={chatOpen} onChatOpenChange={setChatOpen} />}
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
 * 공개 세계관 상세 헤더와 같은 모양: 표지(올린 표지가 있으면 그 이미지, 없으면 생성 표지 아트), 이름, 칩(설정 수·저장 버전·공개 범위·장르·저장 상태), 소개. 이름·소개·수는 저장한 세계관 기준이다.
 * 관리 모드에서는 제목 옆 '편집'이 세계관 정보 편집 패널(이름·설명·공개 범위·장르·표지)을 그 자리에 연다. 저장하지 않은 수정이 있으면 편집이 잠기고 저장 상태는 보기 전환 줄의 저장 영역이 보인다.
 * 헤더에는 공개 범위·장르 칩만 있고, 공개 목록에 나올 때(공개 + 확정 버전)만 공개 화면 링크가, 공개인데 확정 버전이 없을 때는 그 안내가 보인다.
 * 공개 세계관인데 공개로 둔 설정이 없으면 그 경고와 `전체 공개`를, 그 아래에는 연결된 소설을 알리는 상태 줄(정보만)을 보인다.
 * 행동 줄의 소설 버튼은 한 자리다: 연결된 소설이 있으면 그 작품 관리로 가는 `소설 작성하기`, 없으면 `소설 연결하기`(데모는 새 소설 폼으로 가는 `소설 작성하기`). `집필 메모 추가`는 관리 모드에서 보기 전환 줄로 옮겼다.
 * 작성 모드(만든 직후의 마법사)의 이름·설명·공개 설정은 기본 정보 단계에 있고 저장 상태는 헤더 칩이 보이며 '관리 화면으로'로 나갈 수 있다.
 */
function WorldHeader({ vm, world, infoOpen, setInfoOpen }: { vm: VM; world: StudioWorld; infoOpen: boolean; setInfoOpen: (open: boolean) => void }) {
  const saved = vm.saved ?? world
  const manage = vm.mode === 'manage'
  const { visibility, genre } = vm.publication
  const theme = themes[Math.floor(rng(saved.id)() * themes.length)]
  const state = vm.saveState === 'saving' ? { tone: 'wait', text: '저장 중' }
    : vm.saveState === 'failed' ? { tone: 'wait', text: '저장 실패 · 입력은 유지돼요' }
    : vm.dirty ? { tone: 'wait', text: '작성 중 · 미저장' }
    : { tone: 'ok', text: '저장됨' }
  const title = useRef<HTMLHeadingElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const lockId = useId()
  const closed = useRef(false)
  const wasManage = useRef(manage)
  // 처음 저장해 관리 모드로 바뀌면 헤더 제목으로 초점을 옮긴다(바뀐 화면의 맨 위에서 이어 읽게).
  useEffect(() => {
    if (manage && !wasManage.current) title.current?.focus()
    wasManage.current = manage
  }, [manage])
  // 저장·취소로 편집 창이 사라지면 편집 버튼으로 초점을 돌려 키보드 위치를 잃지 않게 한다.
  useEffect(() => {
    if (infoOpen || !closed.current) return
    closed.current = false
    editButton.current?.focus()
  }, [infoOpen])
  const closeInfo = () => {
    closed.current = true
    setInfoOpen(false)
  }
  return (
    <section className="whero ep-hero world-manage-hero">
      <div className="ep-hero-cover">
        <div className="cov">{vm.cover.url ? <img src={vm.cover.url} alt="세계관 표지" /> : <Art theme={theme} w={300} h={400} seed={saved.id} />}<div className="tg"><span className="tag dk">{visibility === 'public' ? '공개' : '비공개'}</span></div></div>
      </div>
      <div className="ep-hero-main">
        <div className="ep-title-row">
          <h1 ref={title} tabIndex={-1} className={infoOpen ? 'sr-only' : undefined}>{saved.name || '이름 없는 세계관'}</h1>
          {manage && !infoOpen && <button ref={editButton} type="button" className="btn sm" aria-label="세계관 정보 편집" aria-describedby={vm.infoLocked ? lockId : undefined} disabled={vm.busy || vm.infoLocked} onClick={() => setInfoOpen(true)}>편집</button>}
        </div>
        {manage && !infoOpen && vm.infoLocked && <p id={lockId} className="small muted">작성 중인 변경을 먼저 저장하세요.</p>}
        <div className="ep-chips">
          <span className="chip">설정 {cardLibraryRows(saved.settings, 'all', '').length}개</span>
          <span className="chip">저장 버전 {saved.version}</span>
          <span className={'chip' + (visibility === 'public' ? ' ok' : '')}>{visibility === 'public' ? '공개' : '비공개'}</span>
          {genre && <span className="chip">{genreLabel(genre)}</span>}
          {!manage && <span role="status" className={'chip ' + state.tone}>{state.text}</span>}
          {vm.relationDirty && <span role="status" className="chip wait">관계 입력 미적용</span>}
        </div>
        {infoOpen
          ? <WorldInfoPanel vm={vm} world={saved} onClose={closeInfo} />
          : saved.description
          ? <p className="sum">{saved.description}</p>
          : <p className="sum ep-muted">{manage ? '편집을 눌러 세계관 소개를 적어 보세요.' : '기본 정보에서 세계관 소개를 적어 보세요.'}</p>}
        <p className="small muted">{vm.storage.intro}</p>
        {vm.listing === 'unlisted' && <p role="status" className="small muted">{UNLISTED_HINT}</p>}
        {manage && !infoOpen && <PublicCardsNotice vm={vm} visibility={visibility} />}
        <WorldLinkedLine vm={vm} />
        <div className="acts">
          {!manage && <NoteButton vm={vm} />}
          <WorldNovelButton vm={vm} />
          {vm.publicHref && <Go to={vm.publicHref} className="btn sm">공개 화면 보기</Go>}
          {!manage && <button type="button" className="btn sm" onClick={vm.leaveWizard}>관리 화면으로</button>}
        </div>
      </div>
    </section>
  )
}

/**
 * 작성 모드 기본 정보 단계의 세계관 단위 공개 범위·장르. 초안 저장과 별개로 바꾸는 즉시 적용된다(공개로 바꿀 때만 한 번 확인). 전송 중에는 잠그고, 실패하면 이전 값 그대로 오류 문구를 보인다.
 * 설정 카드 단위 공개와는 다르다. 관리 모드는 헤더의 정보 편집 패널에서 저장과 함께 적용한다.
 */
function WorldPublish({ vm }: { vm: VM }) {
  return (
    <fieldset className="world-publish world-compact" disabled={vm.busy}>
      <legend className="sr-only">공개 설정</legend>
      <PublishFields value={vm.publishing ?? vm.publication} onChange={vm.setPublication} />
      <p className="small muted">저장과 별개로 바로 적용돼요. 공개한 세계관에는 공개로 둔 설정 카드와 그 사이의 인물 관계만 확정 버전 기준으로 보여요.</p>
      <PublicCardsNotice vm={vm} visibility={(vm.publishing ?? vm.publication).visibility} />
    </fieldset>
  )
}

/**
 * 작성 모드(세계관을 처음 만든 직후, 주소 `?new=1`)는 보기 줄 없이 기본 정보부터 4단계 마법사다. 그 밖의 모든 진입은 관리 모드로, `/content` 작품 관리처럼
 * 헤더 아래 보기 전환 줄(설정집·인물 관계도·시간선, 주소 `?view=`)로 화면을 바꾸고 줄 오른쪽에 `AI 후보 검토 (대기 N)`(시트)·`집필 메모 추가`·`확정 버전 남기기`와 상시 저장 영역을 둔다(이름·설명·공개·표지는 헤더 편집 패널).
 * 확정 버전은 편집 화면의 버전 그래프에서 남기고 본다. 시간선은 저장한 설정의 사건만 보인다.
 */
function WorldEditor({ vm, world, revisions, openVersions }: { vm: VM; world: StudioWorld; revisions: ReturnType<typeof useWorldRevisions>; openVersions: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const manage = vm.mode === 'manage'
  // 작성 모드는 마법사 단계이고, 관리 모드는 보기가 곧 화면이라 설정집·시간선이면 설정 카드, 인물 관계도이면 관계 화면이다.
  const step: StudioStep = manage ? (vm.view === 'people' ? 'relations' : 'cards') : vm.flow.step
  const timeline = manage && vm.view === 'timeline'
  const current = steps.findIndex(([id]) => id === step)
  useEffect(() => { if (vm.flow.screen === 'editor') heading.current?.focus({ preventScroll: true }) }, [step, vm.flow.screen])
  return (
    <section className="world-content" hidden={vm.flow.screen !== 'editor'} aria-busy={vm.busy}>
      <WorldHeader vm={vm} world={world} infoOpen={infoOpen} setInfoOpen={setInfoOpen} />
      {manage && (
        <div className="world-tabs-row">
          <nav className="ep-tabs" aria-label="세계관 메뉴">
            {MANAGE_VIEWS.map(([id, label]) => <button key={id} type="button" aria-current={vm.view === id ? 'page' : undefined} onClick={() => vm.setView(id)}>{label}</button>)}
          </nav>
          <div className="world-tabs-end">
            <WorldAiReview studio={vm} />
            <NoteButton vm={vm} />
            <VersionsButton vm={vm} supported={revisions.supported} open={openVersions} />
            {!vm.selected && <WorldSaveBar vm={vm} />}
          </div>
        </div>
      )}
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
      <section className="tcard ep-card">
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
        <div hidden={step !== 'cards' || timeline}><WorldCardBoard vm={vm} /></div>
        {timeline && (
          <section className="world-confirmed" aria-label="시간선">
            <h3>저장된 시간선</h3>
            <p className="small muted">저장한 설정만 보여드려요. 작성 중 변경과 AI 후보는 포함하지 않아요.</p>
            <WorldTimeline items={vm.saved?.settings.map((s) => s.item) ?? []} />
          </section>
        )}
        {vm.relationWorld === world.id && (
          <div hidden={step !== 'relations'}>
            {!manage && <p className="muted">관계는 필요한 경우에만 연결하세요. 건너뛰어도 저장할 수 있어요.</p>}
            <button className="btn sm" type="button" onClick={vm.returnToCard}>{manage ? '설정집으로 돌아가기' : '설정 카드로 돌아가기'}</button>
            <RelationEpisodePicker studio={vm} />
            <WorldRelationshipEditor key={`${world.id}:${vm.relationKey}`} studio={vm} />
          </div>
        )}
        {!manage && <div hidden={step !== 'review'}><WritingReview vm={vm} /></div>}
        {!manage && (
          <nav className="world-step-actions" aria-label="단계 이동">
            <button className="btn" type="button" disabled={current === 0} onClick={() => vm.goStep(steps[current - 1][0])}>이전 단계</button>
            {current < steps.length - 1 && <button className="btn pri" type="button" onClick={() => vm.goStep(steps[current + 1][0])}>{step === 'relations' ? '검토·저장으로' : '다음 단계'}</button>}
            {step === 'cards' && <button className="btn" type="button" onClick={() => vm.goStep('review')}>관계 없이 검토·저장</button>}
          </nav>
        )}
      </section>
    </section>
  )
}

/**
 * 설정집 화면의 `확정 버전 남기기`: 편집 화면 버전 그래프의 같은 이름 버튼처럼 확정 버전 시트(기존 확정 요청·복구 UI)를 연다. 공개 목록에 나오려면 확정 버전이 필요해 게시판에서도 남길 수 있게 저장 영역 옆에 둔다.
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
 const name=(id:string|null)=>world.settings.find(s=>s.item.id===id)?.item.title||'이름 없는 설정'
 const editInfo=()=>vm.goStep('info')
 return <section className="world-review" aria-label="세계관 검토"><article className="world-review-intro"><div className="world-toolbar"><h4>{world.name||'이름 없는 세계관'}</h4><button className="btn sm" type="button" onClick={editInfo}>기본 정보 수정</button></div><p className="world-prose">{world.description||'설명은 나중에 추가해도 괜찮아요.'}</p></article>
  {vm.writingIssues.length>0&&<div className="world-error" role="alert"><h4>저장 전에 확인해 주세요</h4><ul>{vm.writingIssues.map((issue,i)=><li key={i}><button type="button" onClick={()=>vm.openIssue(issue)}>{writingIssueLabel(world,issue)}</button></li>)}</ul></div>}
  <h4>설정 카드 {cards.length}개</h4>{cards.length?cards.map(s=><article className="world-review-item" key={s.item.id}><div><span className="small muted">{labelOf(s)}</span><h5>{s.item.title||'이름 없는 설정'}</h5><p className="world-prose">{s.item.text||'설명 없음'}</p></div><button className="btn sm" type="button" aria-label={`${s.item.title||'이름 없는 설정'} 수정`} onClick={()=>vm.editCard(s.item.id)}>수정</button></article>):<p className="muted">아직 등록한 설정이 없어요. 기본 정보만 저장해도 괜찮아요.</p>}
  <h4>관계 {relations.length}개</h4>{relations.length?relations.map(s=><article key={s.item.id} className="world-review-item"><div><h5>{name(s.item.subjectId)} → {name(s.item.targetId)}</h5><p className="world-prose">{relationLabel(s.item)}</p></div><button className="btn sm" type="button" onClick={()=>vm.editRelation(s.item.id)}>관계 수정</button></article>):<p className="muted">관계는 선택 사항이에요. 나중에 연결할 수 있어요.</p>}
  <div className="world-save-actions"><p className="small muted">저장은 발행·공개와 달라요.</p><button className="btn pri" type="button" disabled={!vm.canSave} onClick={vm.save}>세계관 저장</button></div>
 </section>
}

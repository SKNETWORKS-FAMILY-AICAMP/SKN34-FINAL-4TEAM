import '../../../shared/episode.css'
import { useEffect, useId, useRef, useState } from 'react'

import { relationLabel } from '../../../../domain/entities/studioRelations'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import type { Theme } from '../../../../domain/entities/work'
import { cardLibraryRows } from '../../../../domain/entities/worldStudioWriting'
import { Art } from '../../../shared/art'
import { rng } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { useScreenId } from '../../../shared/screenIds'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { genreLabel } from '../../../shared/worldGenres'
import { labelOf } from '../viewmodel/settingBoard'
import { UNLISTED_HINT } from '../viewmodel/worldPublication'
import { MANAGE_TABS, type StudioStep } from '../viewmodel/worldStudioFlow'
import { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { InitialWorldReview } from './InitialWorldReview'
import { WorldInfoPanel } from './WorldInfoPanel'
import { WorldCardBoard } from './WorldCardBoard'
import { WorldChat } from './WorldChat'
import { WorldCreate } from './WorldCreate'
import { WorldMap } from './WorldMap'
import { PublishFields } from './WorldPublishFields'
import { WorldRelationshipEditor } from './WorldRelationshipEditor'
import { WorldRevisions } from './WorldRevisions'
import { WorldTimeline } from './WorldTimeline'
import { WorldWiki } from './WorldWiki'
import './world-studio.css'

type VM = ReturnType<typeof useWorldStudioViewModel>
const steps = [['info', '기본 정보'], ['cards', '설정 카드'], ['relations', '관계 연결 (선택)'], ['review', '검토·저장']] as const
const exploreTabs = [['map', '전체 세계관 지도'], ['wiki', '설정집'], ['relations', '인물 관계도'], ['timeline', '초기 역사 시간선']] as const
const themes: Theme[] = ['hanji', 'star', 'neon']

/**
 * 세계관 관리·작성 화면. `/content` 작품 관리와 같은 틀이다: 공용 상단바 아래 서재로 돌아가는 링크, 공개 세계관 상세와 같은 모양의 헤더(표지·이름·칩·소개).
 * 만든 직후(`?new=1`)는 작성 모드(탭 줄 없이 기본 정보 → 설정 카드 → 관계 연결 → 검토·저장 4단계 마법사), 그 밖의 모든 진입은 관리 모드
 * (설정집·인물 관계도·세계관 탐색·AI 후보 검토·확정 버전 탭, 탭 줄 오른쪽의 상시 저장 영역, 헤더의 정보 편집 패널). 주소 `/worldstudio`(세계관 없음)에서만 새 세계관 만들기 화면을 그린다.
 * 새 소설 등록은 실행 모드의 작품 생성 화면에서 시작한다.
 */
export function WorldStudioPage() {
  useScreenId('W01')
  useDocumentTitle('세계관')
  const vm = useWorldStudioViewModel()
  // 집필실과 같이 넓은 화면은 채팅을 연 채로, 좁은 화면(900px 이하)은 닫은 채로 시작한다(열면 오른쪽 서랍).
  const [chatOpen, setChatOpen] = useState(() => !window.matchMedia?.('(max-width: 900px)').matches)
  const loading = !!vm.reviewWorldId && !vm.editing && !vm.error
  return (
    <>
      <Gnb on="lib" />
      <div className={'episode-app' + (vm.editing && chatOpen ? ' with-chat' : '')}>
        <main id="main" tabIndex={-1} className="ep-main world-studio world-writing">
          <div className="ep-top">
            <Go to="/lib?tab=worlds" className="ep-back"><BackChev />내가 만드는 세계관</Go>
          </div>
          {vm.error && <p role="alert" className="ep-alert">{vm.error}</p>}
          {vm.message && <p role="status" className="ep-notice">{vm.message}</p>}
          {loading && <p role="status" className="ep-notice">세계관을 불러오고 있어요…</p>}
          {!vm.reviewWorldId && <WorldCreate vm={vm} />}
          {!vm.editing && vm.reviewWorldId && <InitialWorldReview key={vm.reviewWorldId} studio={vm} />}
          {vm.editing && <WorldEditor vm={vm} world={vm.editing} />}
        </main>
        {vm.editing && <WorldChat open={chatOpen} onOpenChange={setChatOpen} />}
      </div>
      <Footer />
    </>
  )
}

/**
 * 공개 세계관 상세 헤더와 같은 모양: 표지(올린 표지가 있으면 그 이미지, 없으면 생성 표지 아트), 이름, 칩(설정 수·저장 버전·공개 범위·장르·저장 상태), 소개. 이름·소개·수는 저장한 세계관 기준이다.
 * 관리 모드에서는 제목 옆 '편집'이 세계관 정보 편집 패널(이름·설명·공개 범위·장르·표지)을 그 자리에 연다. 저장하지 않은 수정이 있으면 편집이 잠기고 저장 상태는 탭 줄의 저장 영역이 보인다.
 * 헤더에는 공개 범위·장르 칩만 있고, 공개 목록에 나올 때(공개 + 확정 버전)만 공개 화면 링크가, 공개인데 확정 버전이 없을 때는 그 안내가 보인다.
 * 작성 모드(만든 직후의 마법사)의 이름·설명·공개 설정은 기본 정보 단계에 있고 저장 상태는 헤더 칩이 보이며 '관리 화면으로'로 나갈 수 있다.
 */
function WorldHeader({ vm, world, infoOpen, setInfoOpen }: { vm: VM; world: StudioWorld; infoOpen: boolean; setInfoOpen: (open: boolean) => void }) {
  const saved = vm.saved ?? world
  const manage = vm.mode === 'manage'
  const { visibility, genre } = vm.publication
  const theme = themes[Math.floor(rng(saved.id)() * themes.length)]
  const state = vm.saveState === 'saving' ? { tone: 'wait', text: '저장 중' }
    : vm.saveState === 'failed' ? { tone: 'wait', text: '저장 실패 · 입력은 유지됩니다' }
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
        <div className="acts">
          <button type="button" className="btn sm" onClick={() => { vm.goStep('cards'); vm.addCard('note'); vm.setCardDetail(true) }}>집필 메모 추가</button>
          <Go to={import.meta.env.MODE === 'mockup' ? '/new' : '/content'} className="btn sm">새 소설 등록으로</Go>
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
      <p className="small muted">저장과 별개로 바로 적용돼요. 읽는 사람은 공개한 세계관의 설정 카드와 인물 관계를 읽기만 할 수 있어요.</p>
    </fieldset>
  )
}

/**
 * 작성 모드(세계관을 처음 만든 직후, 주소 `?new=1`)는 탭 줄 없이 기본 정보부터 4단계 마법사다. 그 밖의 모든 진입은 관리 모드로, `/content` 작품 관리처럼
 * 탭(설정집·인물 관계도·세계관 탐색·AI 후보 검토·확정 버전, 주소 `?tab=`)으로 기능을 나누고 탭 줄 오른쪽에 상시 저장 영역을 둔다(이름·설명·공개·표지는 헤더 편집 패널).
 */
function WorldEditor({ vm, world }: { vm: VM; world: StudioWorld }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const manage = vm.mode === 'manage'
  // 작성 모드는 마법사 단계이고, 관리 모드는 탭이 곧 화면이라 설정집이면 설정 카드, 인물 관계도이면 관계 화면이다.
  const step: StudioStep = manage ? (vm.tab === 'people' ? 'relations' : 'cards') : vm.flow.step
  const current = steps.findIndex(([id]) => id === step)
  useEffect(() => { if (vm.flow.screen === 'editor') heading.current?.focus({ preventScroll: true }) }, [step, vm.flow.screen])
  return (
    <section className="world-content" hidden={vm.flow.screen !== 'editor'} aria-busy={vm.busy}>
      <WorldHeader vm={vm} world={world} infoOpen={infoOpen} setInfoOpen={setInfoOpen} />
      {manage && (
        <div className="world-tabs-row">
          <nav className="ep-tabs" aria-label="세계관 메뉴">
            {MANAGE_TABS.map(([id, label]) => <button key={id} type="button" aria-current={vm.tab === id ? 'page' : undefined} onClick={() => vm.setTab(id)}>{label}</button>)}
          </nav>
          <WorldSaveBar vm={vm} />
        </div>
      )}
      <div hidden={vm.tool !== 'write'}>
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
          <div hidden={step !== 'cards'}><WorldCardBoard vm={vm} /></div>
          {vm.relationWorld === world.id && (
            <div hidden={step !== 'relations'}>
              {!manage && <p className="muted">관계는 필요한 경우에만 연결하세요. 건너뛰어도 저장할 수 있어요.</p>}
              <button className="btn sm" type="button" onClick={vm.returnToCard}>{manage ? '설정집으로 돌아가기' : '설정 카드로 돌아가기'}</button>
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
      </div>
      {vm.tool === 'explore' && (
        <>
          <nav className="libtabs" aria-label="세계관 탐색 보기">{exploreTabs.map(([id, label]) => <button type="button" key={id} className={vm.explore === id ? 'on' : ''} aria-pressed={vm.explore === id} onClick={() => vm.setExplore(id)}>{label}</button>)}</nav>
          {(vm.explore === 'map' || vm.explore === 'relations') && vm.saved ? <WorldMap key={`${vm.saved.id}:${vm.saved.version}:${vm.explore}`} world={vm.saved} charactersOnly={vm.explore === 'relations'} /> : <Confirmed vm={vm} tab={vm.explore} />}
        </>
      )}
      <div hidden={vm.tool !== 'versions'}><WorldRevisions key={world.id} studio={vm} /></div>
      <div hidden={vm.tool !== 'analysis'}><InitialWorldReview key={world.id} studio={vm} /></div>
    </section>
  )
}

/**
 * 관리 모드의 상시 저장 영역(탭 줄 오른쪽). 바뀐 것이 있으면 '저장하지 않은 변경 있음'과 세계관 저장 버튼, 없으면 '저장됨'이다(한 번도 저장한 적 없는 세계관은 첫 저장을 할 수 있다).
 * 저장 전에 확인할 문제가 있으면 첫 사유와 건수를 버튼 옆에 보이고 저장을 막는다. 저장 로직·검증·충돌 처리는 작성 모드와 같은 `vm.save`다. 탭을 옮겨도 입력은 그대로다.
 */
function WorldSaveBar({ vm }: { vm: VM }) {
  const reason = useId()
  const first = vm.writingIssues[0]
  const text = vm.saveState === 'saving' ? '저장 중…'
    : vm.saveState === 'failed' ? '저장 실패 · 입력은 유지됩니다'
    : vm.dirty ? '저장하지 않은 변경 있음'
    : vm.saved?.version === 0 ? '아직 저장하지 않았어요'
    : '저장됨'
  return (
    <div className="world-save-bar" role="group" aria-label="저장 상태">
      <span role="status" className={'world-save-state ' + (text === '저장됨' ? 'ok' : 'wait')}>{text}</span>
      {first && <span id={reason} className="small">{first.message}{vm.writingIssues.length > 1 && ` 외 ${vm.writingIssues.length - 1}건`}</span>}
      <button type="button" className="btn pri sm" disabled={!vm.canSave} aria-describedby={first ? reason : undefined} onClick={vm.save}>세계관 저장</button>
    </div>
  )
}

function WritingReview({vm}:{vm:VM}){
 const world=vm.editing!,cards=world.settings.filter(s=>s.item.kind!=='relation'),relations=world.settings.filter(s=>s.item.kind==='relation')
 const name=(id:string|null)=>world.settings.find(s=>s.item.id===id)?.item.title||'이름 없는 설정'
 const editInfo=()=>vm.goStep('info')
 return <section className="world-review" aria-label="세계관 검토"><article className="world-review-intro"><div className="world-toolbar"><h4>{world.name||'이름 없는 세계관'}</h4><button className="btn sm" type="button" onClick={editInfo}>기본 정보 수정</button></div><p className="world-prose">{world.description||'설명은 나중에 추가해도 괜찮아요.'}</p></article>
  {vm.writingIssues.length>0&&<div className="world-error" role="alert"><h4>저장 전에 확인해 주세요</h4><ul>{vm.writingIssues.map((issue,i)=><li key={i}><button type="button" onClick={()=>issue.id?vm.editCard(issue.id):editInfo()}>{issue.message}</button></li>)}</ul></div>}
  <h4>설정 카드 {cards.length}개</h4>{cards.length?cards.map(s=><article className="world-review-item" key={s.item.id}><div><span className="small muted">{labelOf(s)}</span><h5>{s.item.title||'이름 없는 설정'}</h5><p className="world-prose">{s.item.text||'설명 없음'}</p></div><button className="btn sm" type="button" aria-label={`${s.item.title||'이름 없는 설정'} 수정`} onClick={()=>vm.editCard(s.item.id)}>수정</button></article>):<p className="muted">아직 등록한 설정이 없어요. 기본 정보만 저장해도 괜찮아요.</p>}
  <h4>관계 {relations.length}개</h4>{relations.length?relations.map(s=><article key={s.item.id} className="world-review-item"><div><h5>{name(s.item.subjectId)} → {name(s.item.targetId)}</h5><p className="world-prose">{relationLabel(s.item)}</p></div><button className="btn sm" type="button" onClick={()=>vm.editRelation(s.item.id)}>관계 수정</button></article>):<p className="muted">관계는 선택 사항이에요. 나중에 연결할 수 있습니다.</p>}
  <div className="world-save-actions"><p className="small muted">저장은 발행·공개와 다릅니다.</p><button className="btn pri" type="button" disabled={!vm.canSave} onClick={vm.save}>세계관 저장</button></div>
 </section>
}

function Confirmed({vm,tab}:{vm:VM;tab:string}) {
 if(tab==='wiki'&&vm.saved)return <WorldWiki key={vm.saved.id} world={vm.saved}/>
 const items=vm.saved?.settings.map(s=>s.item)??[]
 if(tab==='timeline')return <section className="world-confirmed"><h3>저장된 시간선</h3><p className="small muted">저장한 설정만 보여드려요. 작성 중 변경과 AI 후보는 포함하지 않습니다.</p><WorldTimeline items={items}/></section>
 const byId=(id:string|null)=>items.find(i=>i.id===id)?.title??'알 수 없는 항목'
 const rows=tab==='relations'?items.filter(i=>i.kind==='relation'):items
 return <section className="world-confirmed"><h3>{tab==='relations'?'저장된 현재 관계도':'저장된 설정집'}</h3><p className="small muted">저장한 설정만 보여드려요. 작성 중 변경과 AI 후보는 포함하지 않습니다.</p>{!rows.length?<p className="world-empty">아직 확정한 {tab==='relations'?'관계':'설정'}가 없습니다.</p>:rows.map(i=><article key={i.id}>
  <h4>{tab==='relations'?`${byId(i.subjectId)} → ${relationLabel(i)} → ${byId(i.targetId)}`:i.title}</h4><p className="world-prose">{i.text}</p>
 </article>)}</section>
}

import { Suspense,useEffect,useEffectEvent,useId,useRef,useState,type ReactNode } from 'react'
import { useWritingViewModel } from '../viewmodel/useWritingViewModel'
import { publicationActionLabel,type WritingEpisode } from '../../../../domain/entities/content'
import { useVersionComparisonViewModel } from '../viewmodel/useVersionComparisonViewModel'
import './writing.css'
// 오류 상자(.ep-alert)는 작품 관리 화면과 같은 공용 모양을 쓴다.
import '../../../shared/episode.css'
import { Go } from '../../../shared/Go'
import { useScreenId } from '../../../shared/screenIds'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import {ManuscriptBody} from '../../../shared/media/MediaPanel'
import { ManuscriptExportPanel } from './ManuscriptExportPanel'
import { EpisodeImagePanel } from './EpisodeImagePanel'
import { EpisodeWorldBasisControl } from './EpisodeWorldBasisPanel'
import { Sheet } from '../../../shared/Sheet'
import { BackChev,ComposeIcon,FoldIcon,MoreIcon,MoreVerticalIcon,SparkIcon } from '../../../shared/icons'
import { PopMenu } from '../../../shared/PopMenu'
import { useTheme } from '../../../shared/shell/useTheme'
import { uiActions } from '../../../shared/ui/uiSlice'
import { useAppDispatch,useAppSelector } from '../../../../app/store'
import { writingStatus } from '../../../../domain/entities/writingStatus'
import { BODY_MAX,bodyLength,publishBlocker,publishHint } from '../../../../domain/entities/manuscriptLength'
import { VersionComparison } from './VersionComparison'
import { SettingHistoryPanel } from './SettingHistoryPanel'
import { CheckpointPanel } from './CheckpointPanel'
import { PublicationSchedulePanel } from './PublicationSchedulePanel'
import { StoryQaPanel } from '../../../shared/storyContext/StoryQaPanel'
import { versionGraphRows } from '../../../../domain/entities/versionGraph'
import { SimulationStage } from '../../../shared/chat/SimulationStage'
import { useSimulationStageViewModel } from '../../../shared/chat/useSimulationStageViewModel'
import { useWritingChatViewModel } from '../../../shared/chat/useWritingChatViewModel'
import { WritingChat } from '../../../shared/chat/WritingChat'
import { chatBasis } from '../../../../domain/entities/writingChat'
import { VersionGraph } from './VersionGraph'
import { LazyManuscriptEditor } from './LazyManuscriptEditor'
import type { ManuscriptEditorHandle } from './ManuscriptEditor'
import { ResizeSeparator } from './ResizeSeparator'
import './version-panels.css'

// AI 채팅 빈 상태의 추천 칩. 누르면 입력창에 글만 채운다.
const chatSuggestions=['다음 장면 아이디어','이 회차 요약','문장 다듬기']

/** 회차 설정 시트의 의미 묶음: 묶음 사이는 넉넉히, 묶음 안은 촘촘히(스타일은 writing.css). */
function Group({title,className,children}:{title:string;className?:string;children:ReactNode}){
  const titleId=useId()
  return <section className={className?`writing-group ${className}`:'writing-group'} aria-labelledby={titleId}><h3 id={titleId} className="writing-group-title">{title}</h3>{children}</section>
}

/** episode는 주소의 ?ep=n이다. 들어올 때 그 회차를 열고, 목록에 없으면 첫 회차를 연다. */
export function WritingStudio({id,episode}:{id:string;episode?:number}) {
  useScreenId('U13')
  useDocumentTitle('집필실')
  const vm=useWritingViewModel(id,undefined,undefined,episode)
  const editor=useRef<ManuscriptEditorHandle>(null)
  const main=useRef<HTMLElement>(null)
  // 좁은 화면(900px 이하)은 문서가 스크롤하고 상단 바가 화면 위에 붙어 있다. 버튼이 줄바꿈되면 높이가 달라지므로,
  // 본문 툴바가 그 바로 아래에 붙도록 실제 높이를 CSS 변수로 알린다(쓰는 곳은 writing.css의 --writing-toolbar-top).
  const bar=useRef<HTMLElement>(null)
  useEffect(()=>{
    const el=bar.current
    if(!el||typeof ResizeObserver!=='function')return
    const watch=new ResizeObserver(()=>el.parentElement?.style.setProperty('--writing-bar-height',`${el.offsetHeight}px`))
    watch.observe(el)
    return ()=>watch.disconnect()
  },[])
  const settingsButton=useRef<HTMLButtonElement>(null)
  const [settingsOpen,setSettingsOpen]=useState(false)
  // 삭제한 회차·초안의 버튼은 사라지거나 잠기므로 확정된 뒤에만 초점을 main으로 옮긴다.
  // 설정 시트가 닫히며 열었던 버튼으로 초점을 돌리는 정리가 먼저 끝나야 하므로 효과에서 옮긴다.
  const [focusMain,setFocusMain]=useState(0)
  useEffect(()=>{if(focusMain)main.current?.focus()},[focusMain])
  const settled=(removed:boolean)=>{if(removed){setSettingsOpen(false);setFocusMain(n=>n+1)}}
  const orderLookup=vm.orderLookup
  const looking=orderLookup?.status==='loading'
  const listId=useId()
  const menuId=useId()
  // 주소의 ?ep=n이나 삭제로 활성 회차가 바뀌어도 목록에서 그 항목이 보이게 한다. 목록 상자 안에서만 옮긴다(좁은 화면의 가로 띠, 데스크톱 레일의 세로 목록) — 문서 스크롤은 건드리지 않는다.
  const list=useRef<HTMLElement>(null)
  const activeNumber=vm.active?.number
  useEffect(()=>{
    const frame=list.current
    const row=frame?.querySelector('.writing-episode.on')
    if(!frame||!row)return
    const around=frame.getBoundingClientRect(),at=row.getBoundingClientRect()
    if(at.left<around.left||at.right>around.right)frame.scrollLeft+=at.left-around.left-12
    if(at.top<around.top||at.bottom>around.bottom)frame.scrollTop+=at.top-around.top-12
  },[activeNumber,vm.ready])
  // 왼쪽 레일에서 회차 목록이 차지하는 높이 비율(%). 화면 로컬 값이라 새로 열면 처음으로 돌아온다.
  const [split,setSplit]=useState(50)
  const {dark,toggle:toggleTheme}=useTheme()
  const dispatch=useAppDispatch()
  const showSid=useAppSelector(s=>s.ui.showSid)
  const dev=import.meta.env.DEV
  // 기본은 단순 집필이고, 고급은 문맥 선택·장면 비트·고급 플롯 도구가 들어올 자리표시다.
  const [mode,setMode]=useState<'basic'|'advanced'>('basic')
  // 채팅이 본문 폭을 줄이지 않게, 창이 1200px 이하면 접은 채로 시작한다(세계관 작업실의 기본값과 같은 방식).
  const [chatOpen,setChatOpen]=useState(()=>!window.matchMedia?.('(max-width: 1200px)').matches)
  // 접기·열기 버튼은 한 번에 하나만 마운트되므로 ref 하나를 함께 쓴다. 누르면 그 버튼이 사라지니 새로 보이는 버튼으로 초점을 옮긴다(처음 렌더링에서는 옮기지 않는다).
  const chatToggle=useRef<HTMLButtonElement>(null)
  const wasChatOpen=useRef(chatOpen)
  useEffect(()=>{
    if(wasChatOpen.current!==chatOpen)chatToggle.current?.focus()
    wasChatOpen.current=chatOpen
  },[chatOpen])
  const [selection,setSelection]=useState({episode:0,id:''})
  const [rights,setRights]=useState(false)
  const [versionsOpen,setVersionsOpen]=useState(false)
  // 회차 항목의 ⋮ → 발행 이력은 그 회차의 이력만 보여 준다(null이면 전체).
  const [historyEpisode,setHistoryEpisode]=useState<number|null>(null)
  const [historyView,setHistoryView]=useState<'versions'|'compare'|'settings'|'publication'|'schedule'>('versions')
  const active=vm.active
  // 집필 AI 채팅 상태는 채팅 패널과 시뮬레이션 무대가 함께 쓰므로 여기서 만들어 둘에 내려 준다(채팅을 접어도 진행 중인 장면이 끊기지 않는다).
  // 근거는 열린 회차가 발행돼 있으면 그 회차, 아니면 가장 뒤의 발행 회차다. 데모(mockup)는 잠긴다.
  const chat=useWritingChatViewModel(id,chatBasis(vm.episodes,active?.number),vm.aiApplied)
  const stage=useSimulationStageViewModel(chat)
  // 사용자가 무대를 열었을 때만 무대 제목으로 초점을 옮기고(저절로 열린 무대는 초점을 빼앗지 않는다), 닫으면 버튼으로 돌려준다.
  const stageButton=useRef<HTMLButtonElement>(null)
  const stageHeading=useRef<HTMLHeadingElement>(null)
  const [stageFocus,setStageFocus]=useState(0)
  useEffect(()=>{if(stageFocus)stageHeading.current?.focus()},[stageFocus])
  const openStage=()=>{stage.show();setStageFocus(n=>n+1)}
  const closeStage=()=>{stage.hide();stageButton.current?.focus()}
  const historyLabel={
    versions:'원고 저장본 · 공개',
    compare:active?`${active.number}화 원고 버전 비교`:'원고 버전 비교',
    settings:'설정 버전 이력',
    publication:historyEpisode===null?'발행 이력':`${historyEpisode}화 발행 이력`,
    schedule:'예약 발행',
  }[historyView]
  const comparison=useVersionComparisonViewModel(active?.versions??[],versionsOpen&&active?`${id}:${active.number}`:'')
  const selected=active?.number===selection.episode?active.versions.find(v=>v.id===selection.id):undefined
  const leave=(e:{preventDefault():void})=>{if(!vm.mayLeave())e.preventDefault()}
  // 그래프의 저장 버전 노드는 기존 버전 시트를 열고 그 버전을 선택해 둔다(비교·복원·공개는 시트의 기존 기능).
  const openVersion=(versionId:string)=>{if(!active)return;setSelection({episode:active.number,id:versionId});setRights(false);setHistoryView('versions');setVersionsOpen(true)}
  // 항목의 ⋮ 메뉴가 고른 회차를 먼저 선택한다(저장하지 않은 입력을 버리지 않으면 false). 이미 선택된 회차는 다시 고르지 않는다.
  const pick=(e:WritingEpisode)=>{if(active?.number===e.number)return true;if(!vm.select(e))return false;setSelection({episode:0,id:''});setRights(false);return true}
  const deleteActive=async()=>settled(await vm.deleteEpisode())
  // 다른 회차의 삭제는 그 회차가 활성 회차가 된 다음 렌더에서 시작한다(삭제는 렌더 시점의 활성 회차를 지운다).
  const [deleting,setDeleting]=useState(0)
  const deleteWhenSelected=useEffectEvent(()=>void deleteActive())
  useEffect(()=>{if(deleting&&active?.number===deleting){setDeleting(0);deleteWhenSelected()}},[deleting,active?.number])
  const status=writingStatus({ready:vm.ready,busy:vm.busy,error:vm.error,dirty:vm.dirty,active:!!active,hasDraft:active?.hasDraft!==false,inherited:active?.inherited??false})
  const openVersions=()=>{setRights(false);setHistoryView('versions');setVersionsOpen(true)}
  const openSettingHistory=()=>{setHistoryView('settings');setVersionsOpen(true)}
  const openPublication=(episode:number|null=null)=>{setHistoryEpisode(episode);setHistoryView('publication');setVersionsOpen(true);void vm.loadPublicationHistory()}
  const events=vm.publicationHistory?.filter(ev=>historyEpisode===null||ev.episode===historyEpisode)
  const lengthReason=selected&&!active?.inherited?publishBlocker(selected.body):''
  return <div className="calm rd studio writing-studio">
    {/* 상단 바: 왼쪽은 어디서 무엇을 하는지(돌아가기·제목·저장 상태), 오른쪽은 자주 쓰는 네 가지(모드·버전 저장·버전 공개·더보기)만 둔다. */}
    <header ref={bar} className="sbar">
      <div className="writing-bar">
        <Go className="back rback" to="/lib?tab=write" onClick={leave}><BackChev />내가 쓰는 소설</Go>
        <h1 className="t">집필실</h1>
        {/* 완료 안내는 늘 있는 이 줄에 이어 적는다: 알림 문단이 생기고 사라지며 아래 3단을 밀지 않고, 스크린리더도 저장 상태와 함께 한 번만 읽는다. */}
        <span className="st" role="status" aria-live="polite">{status}{vm.notice&&<span className="writing-notice"> · {vm.notice}</span>}</span>
      </div>
      <div className="writing-bar writing-bar-end">
        <div className="svw writing-mode" role="group" aria-label="집필 모드">
          <button type="button" className={mode==='basic'?'on':''} aria-pressed={mode==='basic'} onClick={()=>setMode('basic')}>기본</button>
          <button type="button" className={mode==='advanced'?'on':''} aria-pressed={mode==='advanced'} onClick={()=>setMode('advanced')}>고급</button>
        </div>
        {/* 인물 시뮬레이션 무대는 편집기를 대신해 중앙에 열린다. 누르면 요청 입력(시작 양식)이, 진행 중인 장면이 있으면 그 장면이 보인다. */}
        <button ref={stageButton} type="button" className="tbtn" aria-pressed={stage.open} disabled={!vm.ready||!active} onClick={stage.open?closeStage:openStage}>시뮬레이션</button>
        <button className="tbtn" disabled={vm.busy||!active||active.inherited} onClick={()=>void vm.save()}>버전 저장</button>
        <button className="tbtn pri" disabled={vm.busy||!active} onClick={openVersions}>버전 · 공개</button>
        <PopMenu className="writing-more" label="더보기" icon={<MoreIcon />}>
          <Go role="menuitem" to={`/studio/${id}?view=narrative`} onClick={leave}>플롯</Go>
          <button type="button" role="menuitem" disabled={vm.busy} onClick={()=>void vm.reload()}>다시 불러오기</button>
          <button type="button" role="menuitem" disabled={vm.busy||!vm.ready} onClick={openSettingHistory}>설정 버전 이력</button>
          <button type="button" role="menuitem" disabled={vm.historyLoading} onClick={()=>openPublication()}>발행 이력</button>
          <hr />
          <button type="button" role="menuitem" onClick={toggleTheme}>{dark?'라이트 모드':'다크 모드'}</button>
          {dev&&<button type="button" role="menuitem" onClick={()=>dispatch(uiActions.toggleSid())}>화면 ID {showSid?'끄기':'켜기'}</button>}
        </PopMenu>
      </div>
    </header>
    {vm.error&&<div className="ep-alert" role="alert">{vm.error} {active&&'저장되지 않은 원고는 복사해 보관한 뒤 다시 불러올 수 있어요.'}</div>}
    <main ref={main} id="main" tabIndex={-1} className="studio-workspace">{!vm.ready?<p className="writing-message">회차를 불러오고 있어요…</p>:vm.error&&!active?null:<>
    <div className="sgrid writing-grid">
      <div className="writing-rail">
        <div className="writing-rail-head">
          <h2>회차</h2>
          {/* 서버가 빈 제목을 거부하므로(UseCase·@NotBlank) 제목 없이 만들 때는 기본 제목을 넘긴다. 제목은 편집기 첫 줄에서 바꾼다. */}
          <button type="button" className="writing-icon-btn" aria-label="새 회차" title="새 회차" disabled={vm.busy} onClick={async()=>{if(await vm.create('새 회차')){setRights(false);setSelection({episode:0,id:''})}}}><ComposeIcon /></button>
        </div>
        <div className="writing-rail-split">
          <nav ref={list} id={listId} className="seps writing-episodes" aria-label="회차 목록" style={active?{flexBasis:`${split}%`}:undefined}>
            {vm.episodes.map(e=>{
              const on=active?.number===e.number
              const blocker=vm.deleteBlockerOf(e)
              const reason=`${menuId}-${e.number}`
              return <div className="writing-episode-row" key={e.number}>
                <button className={`writing-episode ${on?'on':''}`} aria-pressed={on} disabled={vm.busy} onClick={()=>void pick(e)}>
                  <strong>{e.number}화 · {e.draft.title}</strong><small>{e.inherited?'원작 기준 · 읽기 전용':e.publishedVersionId?'발행본 있음 · 초안 별도':e.publicationStatus==='suspended'?'공개 중단':'비공개 초안'}</small>
                </button>
                {/* 항목마다 그 회차를 대상으로 하는 메뉴. 회차를 먼저 고른 뒤 기존 시트·삭제 흐름을 그대로 쓴다. */}
                <PopMenu className="writing-episode-more" label={`${e.number}화 더보기`} icon={<MoreVerticalIcon />}>
                  <button type="button" role="menuitem" disabled={vm.busy} onClick={()=>{if(pick(e))setSettingsOpen(true)}}>회차 설정</button>
                  <button type="button" role="menuitem" disabled={vm.busy||!e.checkpoints.length} onClick={()=>{if(pick(e))openVersions()}}>체크포인트</button>
                  {/* 설정 수집 기능은 아직 없다: 가짜 동작 없이 준비 중으로 잠근다. */}
                  <button type="button" role="menuitem" disabled>설정 수집 <small>준비 중</small></button>
                  <button type="button" role="menuitem" disabled={vm.historyLoading} onClick={()=>openPublication(e.number)}>발행 이력</button>
                  <hr />
                  <button type="button" role="menuitem" className="danger" disabled={vm.busy||!!blocker} aria-describedby={blocker?reason:undefined} onClick={()=>{if(on)void deleteActive();else if(pick(e))setDeleting(e.number)}}>회차 삭제</button>
                  {blocker&&<p id={reason} className="pop-menu-note">{blocker}</p>}
                </PopMenu>
              </div>
            })}
          </nav>
          {active&&<>
            <ResizeSeparator label="회차 목록과 버전 그래프 크기 조절" controls={listId} value={split} min={20} max={80} onChange={setSplit} />
            <section className="writing-graph" aria-label="버전 그래프">
              <h2>버전 그래프 · {active.number}화</h2>
              <VersionGraph rows={versionGraphRows(active,vm.dirty)} selectedId={selected?.id??''} disabled={vm.busy} onPick={openVersion}/>
            </section>
          </>}
        </div>
      </div>
      {/* 시뮬레이션 무대가 열려 있는 동안은 편집기 자리를 대신한다. 편집기는 숨기기만 해 입력·되돌리기 기록을 지킨다. */}
      {stage.open&&<SimulationStage stage={stage} workId={id} episode={chat.basisEpisode??active?.number??1} planEpisode={active?.number??null}
        plotLink={<Go to={`/studio/${id}?view=narrative`} onClick={leave}>플롯 화면</Go>} headingRef={stageHeading} onClose={closeStage}/>}
      {/* 가운데는 원고만: 제목 · 본문 · 한 줄 하단 바. 나머지 기능은 '회차 설정' 시트에 있다. */}
      <div className="editor writing-editor" hidden={stage.open}>
        {active?<>
          {active.hasDraft===false&&<p role="status" className="small muted writing-draftless">작업 초안이 없어요. 입력하면 새 초안으로 저장되며, 상단의 버전 · 공개에서 이전 버전을 복원할 수 있어요.</p>}
          <input className="et writing-title" aria-label="회차 제목" placeholder="제목" value={vm.draft.title} maxLength={120} readOnly={active.inherited||vm.editingLocked} onChange={e=>vm.edit({title:e.target.value})}/>
          {/* 원작 기준 회차는 편집기 없이 공용 렌더러로 읽기 전용 본문을 그린다(이름은 같고 읽기 전용임을 보조기기에 알린다).
              내 회차는 마크다운 편집기(Toast UI Editor, 늦게 불러온다): 저장 형식은 그대로 문자열(글자 + 서식 기호 + 이미지 표식)이고 이미지는 기존 업로드 경로(vm.addImage)로 올린다.
              사용자가 누른 요청이 끝날 때까지만 잠그고(editingLocked), 자동 저장은 잠그지 않는다. */}
          {active.inherited
            ?<div className="writing-body writing-readonly" role="textbox" aria-multiline="true" aria-readonly="true" aria-label="원고 본문" tabIndex={0}><ManuscriptBody workId={id} number={active.number} body={vm.draft.body}/></div>
            :<Suspense fallback={<div className="writing-body writing-loading" aria-live="polite">편집기를 불러오고 있어요.</div>}>
              <LazyManuscriptEditor ref={editor} value={vm.draft.body} editable={!vm.editingLocked} busy={vm.busy} workId={id} number={active.number} onChange={body=>vm.edit({body})} onImage={(file,start,end)=>vm.addImage(file,start,end)}/>
            </Suspense>}
          {mode==='advanced'&&<section className="writing-advanced" aria-label="고급 도구">
            <b>고급 도구 준비 중</b>
            <span className="small muted">문맥 선택·장면 비트·고급 플롯 도구가 들어올 자리예요. 지금은 기본 집필과 같은 기능을 써요.</span>
          </section>}
          <footer className="writing-foot">
            <p className="small muted">{bodyLength(vm.draft.body).toLocaleString('ko-KR')} / {BODY_MAX.toLocaleString('ko-KR')}자{!active.inherited&&` · ${publishHint(vm.draft.body)}`} · {active.inherited?'원작 기준 버전을 보존한 원고예요.':'입력을 멈추면 2초 후 초안만 저장해요. 버전 저장과 공개는 각각 선택하세요.'}</p>
            <div className="writing-foot-actions">
              {vm.busy&&<button type="button" className="btn sm" onClick={vm.cancel}>진행 중 요청 취소</button>}
              <button ref={settingsButton} type="button" className="btn sm" aria-haspopup="dialog" onClick={()=>setSettingsOpen(true)}>회차 설정</button>
            </div>
          </footer>
        </>:<p>회차가 없어요. 회차 목록의 새 회차 버튼으로 첫 회차를 만들어 이야기를 시작해 보세요.</p>}
      </div>
    </div>
    {/* 집필실 안의 집필 AI 채팅(#331). 인물 시뮬레이션 장면은 채팅에 상태 한 줄만 보이고 무대 열기가 무대를 연다. */}
    {chatOpen?<aside className="studio-chat writing-chat" aria-label="AI 채팅">
      <div className="studio-chat-head"><h2><span className="chat-brand" aria-hidden="true"><SparkIcon size={16} /></span>AI 채팅</h2><button ref={chatToggle} type="button" className="writing-icon-btn" aria-label="접기" title="접기" onClick={()=>setChatOpen(false)}><FoldIcon /></button></div>
      <WritingChat workId={id} chat={chat} emptyTitle="무엇을 함께 써볼까요?" emptyText="AI의 제안은 승인하기 전까지 원고에 반영되지 않아요." suggestions={chatSuggestions} onOpenStage={openStage}/>
    </aside>:<button ref={chatToggle} type="button" className="studio-chat-toggle btn pri" onClick={()=>setChatOpen(true)}>AI 채팅 열기</button>}
  </>}</main>
          {settingsOpen&&active&&<Sheet sid="U13" label="회차 설정" panelClass="sheet writing-settings-sheet" onClose={()=>setSettingsOpen(false)}>
            <div className="writing-settings">
              <div className="writing-settings-head"><h2>회차 설정 · {active.number}화</h2><button type="button" className="btn sm" onClick={()=>setSettingsOpen(false)}>닫기</button></div>
              {/* 이 시트에서 보낸 요청(이미지 추가·공개 중단·삭제)의 결과는 시트 뒤 화면이 아니라 여기서도 알린다. */}
              {vm.error&&<p className="ep-alert" role="alert">{vm.error}</p>}
              {vm.notice&&<p role="status">{vm.notice}</p>}
              <div className="writing-group">
                <label className="field"><span className="writing-group-title">작가의 말</span><textarea className="ta" value={vm.draft.authorNote ?? ''} maxLength={2000} readOnly={active.inherited||vm.editingLocked} onChange={e=>vm.edit({authorNote:e.target.value})}/></label>
                <p className="small muted">선택 입력 · 최대 2,000자 · 저장 버전을 발행하면 본문 뒤에 공개돼요.</p>
              </div>
              <div className="writing-group">
                {!active.inherited&&<>
                  {/* 편집기의 커서 자리에 올린다. 편집기를 아직 불러오는 중이면(핸들 없음) 조용히 무시하지 않고 원고 끝에 올린다. */}
                  <label className="media-file"><span className="writing-group-title">본문 이미지 추가</span><input type="file" accept=".png,.jpg,.jpeg" disabled={vm.busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void (editor.current?editor.current.addImage(file,false):vm.addImage(file,vm.draft.body.length,vm.draft.body.length))}}/></label>
                  <p className="small muted">PNG·JPEG · 파일당 10 MiB 이하 · 회차당 업로드 최대 10개 · 커서 위치에 참조를 넣어요. 참조를 지워도 저장 버전은 유지돼요.</p>
                  <EpisodeImagePanel workId={id} episode={active.number} draft={vm.draft} unsaved={vm.dirty||vm.busy} onDraftSaved={vm.reload}/>
                </>}
                <details><summary>현재 원고 이미지 미리보기</summary><ManuscriptBody workId={id} number={active.number} body={vm.draft.body}/></details>
              </div>
              <div className="writing-group"><ManuscriptExportPanel workId={id} episode={active.number} inherited={active.inherited} disabled={vm.busy||vm.dirty}/></div>
              {!active.inherited&&import.meta.env.MODE!=='mockup'&&<div className="writing-group"><EpisodeWorldBasisControl key={active.number} workId={id} number={active.number}/></div>}
              {active.publishedVersionId&&import.meta.env.MODE!=='mockup'&&<div className="writing-group"><StoryQaPanel
                key={`${id}/${active.number}/${active.publishedVersionId}`} workId={id} episode={active.number} versionId={active.publishedVersionId} owner/></div>}
              <Group title="회차 관리">
                <div className="writing-actions">
                  {!active.inherited&&active.publishedVersionId&&<button className="btn sm" disabled={vm.busy||vm.dirty} onClick={async()=>{if(await vm.changeVisibility(false,false))setRights(false)}}>회차 공개 중단</button>}
                  {!active.inherited&&active.publicationStatus==='suspended'&&<>
                    <label><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/> 중단했던 발행본을 다시 공개할 권리를 확인합니다.</label>
                    <button className="btn sm" disabled={vm.busy||vm.dirty||!rights} onClick={async()=>{if(await vm.changeVisibility(true,rights))setRights(false)}}>회차 재공개</button>
                  </>}
                  {/* 발행 이력 시트가 닫힐 때 초점이 사라질 이 버튼 대신 항상 남아 있는 '회차 설정' 버튼으로 돌아오게, 시트를 바꾸기 전에 초점을 옮겨 둔다. */}
                  <button className="btn sm" disabled={vm.historyLoading} onClick={()=>{settingsButton.current?.focus();setSettingsOpen(false);openPublication()}}>발행 이력</button>
                  <button className="btn sm" disabled={vm.busy||looking} aria-busy={looking} onClick={()=>void vm.checkOrder()}>순서 변경 가능 범위 확인</button>
                  <div role="status" aria-live="polite" className="small writing-order-status">{orderLookup?.status==='loading'?'순서 변경 후보를 확인하고 있어요…':orderLookup?.status==='failed'?orderLookup.message:orderLookup?.status==='ready'&&<>
                    <p>검토 후보 위치 {orderLookup.scope.candidateNumbers.map(n=>`${n}화`).join(', ')||'없음'}</p>
                    <ul>{orderLookup.scope.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
                  </>}</div>
                </div>
              </Group>
              <Group title="위험 영역" className="writing-danger">
                <div className="writing-actions">
                  <button className="btn sm danger" disabled={vm.busy||active.inherited||active.hasDraft===false} onClick={async()=>settled(await vm.deleteDraft())}>초안 삭제</button>
                  <button className="btn sm danger" disabled={vm.busy||active.inherited||!!vm.deleteBlocker} aria-describedby={vm.deleteBlocker?'episode-delete-reason':undefined} onClick={async()=>settled(await vm.deleteEpisode())}>회차 삭제</button>
                </div>
                {vm.deleteBlocker&&<small id="episode-delete-reason" className="muted">{vm.deleteBlocker}</small>}
              </Group>
            </div>
          </Sheet>}
          {versionsOpen&&<Sheet sid="U21" label={historyLabel} panelClass={`sheet writing-history-sheet${historyView==='compare'?' writing-history-wide':''}`} onClose={()=>setVersionsOpen(false)}><section className="writing-history">
            <button type="button" className="btn sm" onClick={()=>setVersionsOpen(false)}>닫기</button>
            <nav className="version-panel-nav" aria-label="버전 관리">
              <button type="button" className="btn sm" disabled={!active} aria-current={historyView==='versions'?'page':undefined} onClick={()=>setHistoryView('versions')}>원고 저장본 · 공개</button>
              <button type="button" className="btn sm" disabled={!active} aria-current={historyView==='compare'?'page':undefined} onClick={()=>setHistoryView('compare')}>원고 버전 비교</button>
              <button type="button" className="btn sm" aria-current={historyView==='settings'?'page':undefined} onClick={()=>setHistoryView('settings')}>설정 버전 이력</button>
              <button type="button" className="btn sm" disabled={vm.historyLoading} aria-current={historyView==='publication'?'page':undefined} onClick={()=>{setHistoryEpisode(null);setHistoryView('publication');void vm.loadPublicationHistory()}}>발행 이력</button>
              {active&&!active.inherited&&<button type="button" className="btn sm" aria-current={historyView==='schedule'?'page':undefined} onClick={()=>setHistoryView('schedule')}>예약 발행</button>}
            </nav>
            {historyView==='publication'?<>
              <h2>{historyLabel}</h2>
              {vm.historyError&&<p className="ep-alert" role="alert">{vm.historyError}</p>}
              {vm.historyLoading?<p role="status">발행 이력을 불러오고 있어요…</p>:events&&<>
                {!events.length&&<p>{historyEpisode===null?'아직 발행 이력이 없어요.':'이 회차의 발행 이력이 아직 없어요.'}</p>}
                <ol>{events.map((event,i)=><li key={i}>
                  {event.episode}화 · {publicationActionLabel[event.action]} · {new Date(event.publishedAt).toLocaleString('ko-KR')}<small> · 버전 {event.versionId}</small>
                </li>)}</ol>
              </>}
            </>:historyView==='settings'?<SettingHistoryPanel key={id} workId={id}/>:!active?<p>회차를 선택해 주세요.</p>:historyView==='schedule'?(active.inherited?<p>원작 기준 회차는 예약 발행할 수 없어요.</p>:
              <PublicationSchedulePanel key={`${id}:${active.number}`} workId={id} episode={active}/>):historyView==='compare'?<>
              <h2>{historyLabel}</h2>
              <VersionComparison workId={id} number={active.number} versions={active.versions} model={comparison}/>
            </>:<>
            {vm.error&&<p className="ep-alert" role="alert">{vm.error}</p>}
            {vm.notice&&<p role="status">{vm.notice}</p>}
            <h2>{historyLabel}</h2>
            <CheckpointPanel key={`${id}:${active.number}`} workId={id} episode={active} disabled={vm.busy||vm.dirty||active.inherited} onRevert={vm.revertCheckpoint}/>
            {!active.versions.length?<p>아직 저장한 버전이 없어요. 상단의 버전 저장을 눌러 원고를 남겨 주세요.</p>:<>
              <label className="field">검토할 저장 버전<select className="inp" value={selected?.id??''} onChange={e=>{setSelection({episode:active.number,id:e.target.value});setRights(false)}}>
                <option value="">버전 선택</option>{active.versions.map((v,i)=><option value={v.id} key={v.id}>버전 {i+1} · {v.title} · {new Date(v.savedAt).toLocaleString('ko-KR')}{active.publishedVersionId===v.id?' · 현재 발행본':''}</option>)}
              </select></label>
              {selected&&<><h3>{selected.title}</h3><div className="writing-preview" tabIndex={0} role="region" aria-label="선택한 저장 버전 원고"><ManuscriptBody workId={id} number={active.number} body={selected.body||'(빈 원고)'}/></div>
                {selected.authorNote&&<section className="author-note"><h3>작가의 말</h3><p>{selected.authorNote}</p></section>}
                <button className="btn" disabled={vm.busy||active.inherited} onClick={()=>void vm.restore(selected.id)}>선택 버전을 새 버전으로 복원</button>
                <label className="writing-rights"><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/> 이 저장 원고를 공개할 권리가 있음을 확인합니다.</label>
                {/* 공개할 때만 본문 5,000자 이상이 필요하다(UC-10). 복원·저장은 분량과 무관하다. */}
                <button className="btn pri" disabled={vm.busy||vm.dirty||!rights||active.inherited||!selected.body.trim()||!!lengthReason} aria-describedby={lengthReason?'publish-length-reason':undefined} onClick={async()=>{if(await vm.publish(selected.id,rights))setRights(false)}}>선택한 저장 버전 공개</button>
                {lengthReason&&<small id="publish-length-reason" className="muted writing-publish-reason">{lengthReason}</small>}
              </>}
            </>}
            <p className="small muted">원고와 허용된 설정을 버전 기준으로 보관해요. 인물·관계 저장소 동기화는 아직 지원하지 않아요.</p>
            </>}
          </section></Sheet>}
  </div>
}

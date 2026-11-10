import { useRef,useState } from 'react'
import { useWritingViewModel } from '../viewmodel/useWritingViewModel'
import { publicationActionLabel } from '../../../../domain/entities/content'
import { useVersionComparisonViewModel } from '../viewmodel/useVersionComparisonViewModel'
import './writing.css'
import { Go } from '../../../shared/Go'
import { useScreenId } from '../../../shared/screenIds'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import {ManuscriptBody} from '../../../shared/media/MediaPanel'
import { ManuscriptExportPanel } from './ManuscriptExportPanel'
import { EpisodeImagePanel } from './EpisodeImagePanel'
import { EpisodeWorldBasisControl } from './EpisodeWorldBasisPanel'
import { Sheet } from '../../../shared/Sheet'
import { BackChev } from '../../../shared/icons'
import { writingStatus } from '../../../../domain/entities/writingStatus'
import { VersionComparison } from './VersionComparison'
import {AiRunPanel} from './AiRunPanel'
import { SettingHistoryPanel } from './SettingHistoryPanel'
import { CheckpointPanel } from './CheckpointPanel'
import { PublicationSchedulePanel } from './PublicationSchedulePanel'
import './version-panels.css'

export function WritingStudio({id}:{id:string}) {
  useScreenId('U13')
  useDocumentTitle('집필실')
  const vm=useWritingViewModel(id)
  const bodyInput=useRef<HTMLTextAreaElement>(null)
  const main=useRef<HTMLElement>(null)
  // 삭제한 회차·초안의 버튼은 사라지거나 잠기므로 확정된 뒤에만 초점을 main으로 옮긴다.
  const settled=(removed:boolean)=>{if(removed)main.current?.focus()}
  const orderLookup=vm.orderLookup
  const looking=orderLookup?.status==='loading'
  const [title,setTitle]=useState('')
  const [textSelection,setTextSelection]=useState({start:0,end:0})
  const [selection,setSelection]=useState({episode:0,id:''})
  const [rights,setRights]=useState(false)
  const [versionsOpen,setVersionsOpen]=useState(false)
  const [historyView,setHistoryView]=useState<'versions'|'compare'|'settings'|'publication'|'schedule'>('versions')
  const active=vm.active
  const historyLabel={
    versions:'원고 저장본 · 공개',
    compare:active?`${active.number}화 원고 버전 비교`:'원고 버전 비교',
    settings:'설정 버전 이력',
    publication:'발행 이력',
    schedule:'예약 발행',
  }[historyView]
  const comparison=useVersionComparisonViewModel(active?.versions??[],versionsOpen&&active?`${id}:${active.number}`:'')
  const selected=active?.number===selection.episode?active.versions.find(v=>v.id===selection.id):undefined
  const leave=(e:{preventDefault():void})=>{if(!vm.mayLeave())e.preventDefault()}
  const status=writingStatus({ready:vm.ready,busy:vm.busy,error:vm.error,dirty:vm.dirty,active:!!active,hasDraft:active?.hasDraft!==false,inherited:active?.inherited??false})
  return <div className="calm rd studio writing-studio">
    <header className="sbar">
      <Go className="back" to="/lib?tab=write" onClick={leave}><BackChev />내가 쓰는 소설</Go><h1 className="t">집필실</h1>
      <Go className="tbtn" to={`/studio/${id}?view=narrative`} onClick={leave}>플롯</Go>
      <span className="st" role="status" aria-live="polite">{status}</span>
      <button className="tbtn" disabled={vm.busy||!active||active.inherited} onClick={()=>void vm.save()}>버전 저장</button>
      <button className="tbtn" disabled={vm.busy} onClick={()=>void vm.reload()}>다시 불러오기</button>
      <button className="tbtn pri" disabled={vm.busy||!active} onClick={()=>{setRights(false);setHistoryView('versions');setVersionsOpen(true)}}>원고 버전 · 비교 · 공개</button>
      <button className="tbtn writing-setting-history" disabled={vm.busy||!vm.ready} onClick={()=>{setHistoryView('settings');setVersionsOpen(true)}}>설정 버전 이력</button>
    </header>
    {vm.error&&<div className="writing-message" role="alert">{vm.error} {active&&'저장되지 않은 원고는 복사해 보관한 뒤 다시 불러올 수 있어요.'}</div>}
    {vm.notice&&<p className="writing-message" role="status">{vm.notice}</p>}
    <main ref={main} id="main" tabIndex={-1} className="studio-workspace">{!vm.ready?<p className="writing-message">회차를 불러오고 있어요…</p>:vm.error&&!active?null:<div className="sgrid">
      <nav className="seps" aria-label="회차 목록">
        <h2 className="lab">회차</h2>
        {vm.episodes.map(e=><button className={`writing-episode ${active?.number===e.number?'on':''}`} key={e.number} aria-pressed={active?.number===e.number} disabled={vm.busy} onClick={()=>{if(!vm.select(e))return;setSelection({episode:0,id:''});setRights(false)}}>
          <strong>{e.number}화 · {e.draft.title}</strong><small>{e.inherited?'원작 기준 · 읽기 전용':e.publishedVersionId?'발행본 있음 · 초안 별도':e.publicationStatus==='suspended'?'공개 중단':'비공개 초안'}</small>
        </button>)}
        <form className="writing-create" onSubmit={async e=>{e.preventDefault();if(await vm.create(title)){setTitle('');setRights(false);setSelection({episode:0,id:''})}}}>
          <label className="field">새 회차 제목<input className="inp" value={title} maxLength={120} required disabled={vm.busy} onChange={e=>setTitle(e.target.value)}/></label>
          <button className="btn" disabled={vm.busy||!title.trim()}>회차 생성</button>
        </form>
      </nav>
      <div className="editor writing-editor">
        {active?<>
          <p className="muted">{active.number}화 · {active.inherited?'원작 기준 버전을 보존한 원고예요.':'입력을 멈추면 2초 후 초안만 저장해요. 버전 저장과 공개는 각각 선택하세요.'}</p>
          <label className="field">회차 제목<input className="et" value={vm.draft.title} maxLength={120} readOnly={active.inherited||vm.editingLocked} onChange={e=>vm.edit({title:e.target.value})}/></label>
          <label className="field">원고 본문<textarea ref={bodyInput} className="eb writing-body" value={vm.draft.body} maxLength={40000} readOnly={active.inherited||vm.editingLocked} onSelect={e=>{const node=e.currentTarget;setTextSelection({start:node.selectionStart,end:node.selectionEnd})}} onChange={e=>{setTextSelection({start:0,end:0});vm.edit({body:e.target.value})}}/></label>
          <p className="small muted">{vm.draft.body.length.toLocaleString('ko-KR')} / 40,000자</p>
          <label className="field">작가의 말<textarea className="ta" value={vm.draft.authorNote ?? ''} maxLength={2000} readOnly={active.inherited||vm.editingLocked} onChange={e=>vm.edit({authorNote:e.target.value})}/></label>
          <p className="small muted">선택 입력 · 최대 2,000자. 저장 버전을 발행하면 본문 뒤에 공개됩니다.</p>
          {!active.inherited&&<label className="media-file">본문 이미지 추가<input type="file" accept=".png,.jpg,.jpeg" disabled={vm.busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void vm.addImage(file,bodyInput.current?.selectionStart??vm.draft.body.length,bodyInput.current?.selectionEnd??vm.draft.body.length)}}/></label>}
          <p className="small muted">PNG·JPEG · 파일당 10 MiB 이하 · 회차당 업로드 최대 10개. 커서 위치에 이미지 참조를 넣어요. 참조를 지우면 현재 원고에서만 빠지고 저장 버전은 유지돼요.</p>
          <ManuscriptExportPanel workId={id} episode={active.number} inherited={active.inherited} disabled={vm.busy||vm.dirty}/>
          {!active.inherited&&<EpisodeImagePanel workId={id} episode={active.number} draft={vm.draft} unsaved={vm.dirty||vm.busy} onDraftSaved={vm.reload}/>}
          {vm.busy&&<button className="btn sm" onClick={vm.cancel}>진행 중 요청 취소</button>}
          <details><summary>현재 원고 이미지 미리보기</summary><ManuscriptBody workId={id} number={active.number} body={vm.draft.body}/></details>
          {!active.inherited&&import.meta.env.MODE!=='mockup'&&<EpisodeWorldBasisControl key={active.number} workId={id} number={active.number}/>}
          <section aria-label="회차 관리">
            <div className="writing-order">
              <button className="btn sm" disabled={vm.busy||looking} aria-busy={looking} onClick={()=>void vm.checkOrder()}>순서 변경 가능 범위 확인</button>
              <div role="status" aria-live="polite" className="small">{orderLookup?.status==='loading'?'순서 변경 후보를 확인하고 있어요…':orderLookup?.status==='failed'?orderLookup.message:orderLookup?.status==='ready'&&<>
                <p>검토 후보 위치 {orderLookup.scope.candidateNumbers.map(n=>`${n}화`).join(', ')||'없음'}</p>
                <ul>{orderLookup.scope.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
              </>}</div>
            </div>
            <button className="btn sm danger" disabled={vm.busy||active.inherited||active.hasDraft===false} onClick={async()=>settled(await vm.deleteDraft())}>초안 삭제</button>
            <button className="btn sm danger" disabled={vm.busy||active.inherited||!!vm.deleteBlocker} aria-describedby={vm.deleteBlocker?'episode-delete-reason':undefined} onClick={async()=>settled(await vm.deleteEpisode())}>회차 삭제</button>
            {vm.deleteBlocker&&<small id="episode-delete-reason" className="muted">{vm.deleteBlocker}</small>}
            {!active.inherited&&active.publishedVersionId&&<button className="btn sm" disabled={vm.busy||vm.dirty} onClick={async()=>{if(await vm.changeVisibility(false,false))setRights(false)}}>회차 공개 중단</button>}
            {!active.inherited&&active.publicationStatus==='suspended'&&<>
              <label><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/> 중단했던 발행본을 다시 공개할 권리를 확인합니다.</label>
              <button className="btn sm" disabled={vm.busy||vm.dirty||!rights} onClick={async()=>{if(await vm.changeVisibility(true,rights))setRights(false)}}>회차 재공개</button>
            </>}
            <button className="btn sm" disabled={vm.historyLoading} onClick={()=>{setHistoryView('publication');setVersionsOpen(true);void vm.loadPublicationHistory()}}>발행 이력</button>
            {active.hasDraft===false&&<p role="status">작업 초안이 없어요. 입력하면 새 초안으로 저장되며, 상단의 원고 버전 · 비교 · 공개에서 이전 버전을 복원할 수 있어요.</p>}
          </section>
          <AiRunPanel onAccessDenied={vm.clearPrivate} drafts={vm.episodes} work={id} episode={active.number} revision={vm.draft.revision} body={vm.draft.body} selection={textSelection} available={!vm.busy&&!vm.dirty&&!active.inherited&&active.hasDraft!==false} onApplied={()=>void vm.reload()}/>
        </>:<p>회차가 없어요. 첫 회차를 만들어 이야기를 시작해 보세요.</p>}
      </div>
    </div>}</main>
          {versionsOpen&&<Sheet sid="U21" label={historyLabel} panelClass={`sheet writing-history-sheet${historyView==='compare'?' writing-history-wide':''}`} onClose={()=>setVersionsOpen(false)}><section className="writing-history">
            <button type="button" className="btn sm" onClick={()=>setVersionsOpen(false)}>닫기</button>
            <nav className="version-panel-nav" aria-label="버전 관리">
              <button type="button" className="btn sm" disabled={!active} aria-pressed={historyView==='versions'} onClick={()=>setHistoryView('versions')}>원고 저장본 · 공개</button>
              <button type="button" className="btn sm" disabled={!active} aria-pressed={historyView==='compare'} onClick={()=>setHistoryView('compare')}>원고 버전 비교</button>
              <button type="button" className="btn sm" aria-pressed={historyView==='settings'} onClick={()=>setHistoryView('settings')}>설정 버전 이력</button>
              <button type="button" className="btn sm" disabled={vm.historyLoading} aria-pressed={historyView==='publication'} onClick={()=>{setHistoryView('publication');void vm.loadPublicationHistory()}}>발행 이력</button>
              {active&&!active.inherited&&<button type="button" className="btn sm" aria-pressed={historyView==='schedule'} onClick={()=>setHistoryView('schedule')}>예약 발행</button>}
            </nav>
            {historyView==='publication'?<>
              <h2>발행 이력</h2>
              {vm.historyError&&<p role="alert">{vm.historyError}</p>}
              {vm.historyLoading?<p role="status">발행 이력을 불러오고 있어요…</p>:vm.publicationHistory&&<>
                {!vm.publicationHistory.length&&<p>아직 발행 이력이 없어요.</p>}
                <ol>{vm.publicationHistory.map((event,i)=><li key={i}>
                  {event.episode}화 · {publicationActionLabel[event.action]} · {new Date(event.publishedAt).toLocaleString('ko-KR')}<small> · 버전 {event.versionId}</small>
                </li>)}</ol>
              </>}
            </>:historyView==='settings'?<SettingHistoryPanel key={id} workId={id}/>:!active?<p>회차를 선택해 주세요.</p>:historyView==='schedule'?(active.inherited?<p>원작 기준 회차는 예약 발행할 수 없어요.</p>:
              <PublicationSchedulePanel key={`${id}:${active.number}`} workId={id} episode={active}/>):historyView==='compare'?<>
              <h2>{historyLabel}</h2>
              <VersionComparison workId={id} number={active.number} versions={active.versions} model={comparison}/>
            </>:<>
            {vm.error&&<p role="alert">{vm.error}</p>}
            {vm.notice&&<p role="status">{vm.notice}</p>}
            <h2>{historyLabel}</h2>
            <CheckpointPanel key={`${id}:${active.number}`} workId={id} episode={active} disabled={vm.busy||vm.dirty||active.inherited} onRevert={vm.revertCheckpoint}/>
            {!active.versions.length?<p>아직 저장한 버전이 없어요. 상단의 버전 저장을 눌러 원고를 남겨 주세요.</p>:<>
              <label className="field">검토할 저장 버전<select className="inp" value={selected?.id??''} onChange={e=>{setSelection({episode:active.number,id:e.target.value});setRights(false)}}>
                <option value="">버전 선택</option>{active.versions.map((v,i)=><option value={v.id} key={v.id}>버전 {i+1} · {v.title} · {new Date(v.savedAt).toLocaleString('ko-KR')}{active.publishedVersionId===v.id?' · 현재 발행본':''}</option>)}
              </select></label>
              {selected&&<><h3>{selected.title}</h3><div className="writing-preview"><ManuscriptBody workId={id} number={active.number} body={selected.body||'(빈 원고)'}/></div>
                {selected.authorNote&&<section className="author-note"><h3>작가의 말</h3><p>{selected.authorNote}</p></section>}
                <button className="btn" disabled={vm.busy||active.inherited} onClick={()=>void vm.restore(selected.id)}>선택 버전을 새 버전으로 복원</button>
                <label className="writing-rights"><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/> 이 저장 원고를 공개할 권리가 있음을 확인합니다.</label>
                <button className="btn pri" disabled={vm.busy||vm.dirty||!rights||active.inherited||!selected.body.trim()} onClick={async()=>{if(await vm.publish(selected.id,rights))setRights(false)}}>선택한 저장 버전 공개</button>
              </>}
            </>}
            <p className="small muted">원고와 허용된 설정을 버전 기준으로 보관해요. 인물·관계 저장소 동기화는 아직 지원하지 않아요.</p>
            </>}
          </section></Sheet>}
  </div>
}

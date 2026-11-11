import {WorldCandidates} from './WorldCandidates'
import {useRef,useState,type FormEvent} from 'react'
import {useInitialWorldReview} from '../viewmodel/useInitialWorldReview'
import type {useWorldStudioViewModel} from '../viewmodel/useWorldStudioViewModel'
import type {Candidate,ReviewAction} from '../../../../domain/entities/initialWorld'
const types:Record<Candidate['type'],string>={fact:'사실',relation:'관계',rule:'규칙',event:'발생한 사건',conjecture:'추측',goal:'목표',plan:'계획'}
const states={pending:'검토 대기',approved:'작가 승인 · 초안 반영 전',held:'보류',rejected:'거절'}
const execution={running:'분석 중',completed:'분석 완료',failed:'분석 실패',unknown:'분석 결과 미확인'}
type VM=ReturnType<typeof useWorldStudioViewModel>
export function InitialWorldReview({studio}:{studio:VM}){
 const vm=useInitialWorldReview(studio.reviewWorldId,studio.tool==='analysis'||!studio.editing,studio.dirty||studio.relationDirty,studio.saved?.version,studio.reload,studio.setReviewBusy)
 const heads=useRef<Record<string,HTMLElement|null>>({}),analysis=vm.analysis,blocked=vm.busy||vm.pending||analysis?.freshness==='stale'||analysis?.executionStatus!=='completed'
 const name=(id:string|null)=>studio.saved?.settings.find(s=>s.item.id===id)?.item.title??'연결된 설정'
 if(vm.demo)return <section className="world-analysis"><h3>AI 후보 검토</h3><p>목업 모드는 실제 AI 분석·검토 저장·초안 반영을 지원하지 않습니다.</p><button className="btn" disabled>AI 분석 요청 · 실제 서버 모드에서 사용</button><WorldCandidates analysis={studio.saved?.analysis??null}/></section>
 return <section className="world-analysis initial-review" aria-label="AI 후보 검토" aria-busy={vm.busy}>
  <h3>AI 후보 검토</h3><p>저장된 초안을 분석해 제안한 내용입니다. 작가 승인 후 ‘세계관 초안에 반영’을 눌러야 설정에 추가됩니다.</p>
  {(studio.dirty||studio.relationDirty)&&<p role="status">작성 중인 입력이 있어요. 기존 작성 화면에서 먼저 저장해 주세요.</p>}
  {vm.error&&<p role="alert" className="world-error">{vm.error}</p>}{vm.message&&<p role="status">{vm.message}</p>}
  <div className="initial-actions"><button className="btn pri" disabled={vm.busy||vm.pending||studio.dirty||studio.relationDirty||!studio.saved} onClick={vm.analyze}>저장된 초안 분석</button><button className="btn" disabled={vm.busy} onClick={vm.refresh}>결과 새로 확인</button></div>
  {vm.pending&&<div className="initial-recovery"><p>결과를 확인하지 못한 요청이 있습니다. 새 요청을 만들지 않고 기존 요청을 그대로 확인합니다. 새로고침·재로그인 후에도 이 브라우저에서 이어서 확인할 수 있습니다.</p><button className="btn" disabled={vm.busy} onClick={vm.recover}>같은 요청으로 확인·복구</button></div>}
  {!!vm.analyses.length&&<label className="field">분석 기록<select className="inp" value={analysis?.analysisId??''} disabled={vm.busy||vm.pending} onChange={e=>vm.select(e.target.value)}>{vm.analyses.map((a,i)=><option key={a.analysisId} value={a.analysisId}>분석 {vm.analyses.length-i} · {execution[a.executionStatus]}{a.freshness==='stale'?' · 원본 변경됨':''}</option>)}</select></label>}
  {!analysis&&!vm.busy&&<p>아직 분석 후보가 없습니다. 저장된 초안으로 분석을 시작하세요.</p>}
  {analysis&&<><p role="status">{execution[analysis.executionStatus]}{analysis.freshness==='stale'?' · 원본이 변경되어 새 검토·반영은 할 수 없습니다. 저장 후 재분석해 주세요.':''}</p>
   {analysis.output?.diagnostics.map((d,i)=><p key={i} className="small">분석 안내: {d}</p>)}
   {analysis.output?.candidates.map(original=>{const current=vm.current(original)!;const applied=studio.saved?.settings.some(s=>{const p=s.serverMetadata?.preprocessing;return p&&typeof p==='object'&&'candidateId'in p&&p.candidateId===current.id})
    // 결정 저장 뒤 article이 재마운트되면 포커스가 body로 빠진다: key에 sequence를 빼고, 끝났을 때 포커스가 그대로이거나 body로 빠진 경우에만 제목으로 되돌린다(대기 중 사용자가 옮긴 포커스는 뺏지 않는다).
    const decide=async(action:ReviewAction,edited:Candidate|null)=>{const from=document.activeElement;await vm.decide(original,action,edited,'');const now=document.activeElement;if(now===from||now===document.body)heads.current[current.id]?.focus({preventScroll:true})}
    return <article className="world-candidate" key={`${analysis.analysisId}:${current.id}`}>
    <div className="initial-candidate-heading"><h4 tabIndex={-1} ref={el=>{heads.current[current.id]=el}}>{current.content.title}</h4><span>{types[current.content.type]} · {applied?'초안 반영 완료':states[current.state]}</span></div>
    <p className="initial-source-label">{current.content.provenance==='author_revision'?'작가가 수정한 내용':'AI가 제안한 내용'}</p>{current.content.polarity==='denied'&&<p className="initial-source-label">부정: 아래 내용이 사실이 아니라는 제안입니다</p>}<p className="initial-copy">{current.content.text}</p>
    {current.content.condition.trim()&&<p>적용 조건: {current.content.condition}</p>}{current.content.timeText.trim()&&<p>이야기 속 시점: {current.content.timeText}</p>}
    {current.content.subjectId&&<p>관련 설정: {name(current.content.subjectId)}</p>}
    {current.content.relation&&<p>{name(current.content.relation.sourceCardId)} {current.content.relation.direction==='symmetric'?'↔':'→'} {name(current.content.relation.targetCardId)} · {current.content.relation.category==='emotional'?'감정':'구조 관계'} · {current.content.relation.label}{current.content.relation.polarity==='denied'?' (부정)':''}</p>}
    <details><summary>원래 AI 제안과 원문 근거</summary><p className="initial-copy">{original.text}</p>{original.evidence.map((e,i)=><blockquote key={i}><span className="small">{e.sourceId.endsWith(':description')?'세계관 설명':e.sourceId.endsWith(':title')?'설정 이름':'설정 내용'}에서 인용</span><p className="initial-copy">{e.quote}</p></blockquote>)}{current.content.provenance==='author_revision'&&<p>위 근거는 원래 AI 제안의 근거이며, 작가 수정본의 근거가 아닙니다.</p>}</details>
    <details><summary>검토 이력</summary>{analysis.decisions.filter(d=>d.candidateId===current.id).map(d=><p key={d.sequence}>{states[d.state]} · {d.content.text}</p>)}</details>
    <fieldset disabled={blocked}><legend className="sr-only">{current.content.title} 검토 결정</legend><div className="initial-actions"><button className="btn" onClick={()=>decide('approve',null)}>승인</button><button className="btn" onClick={()=>decide('hold',null)}>보류</button><button className="btn" onClick={()=>decide('reject',null)}>거절</button></div>
     <CandidateEdit key={current.sequence} candidate={current.content} save={edited=>decide('edit',edited)}/>
     <label className="initial-select"><input type="checkbox" disabled={current.state!=='approved'} checked={vm.checked.includes(current.id)} onChange={()=>vm.toggle(current.id)}/>초안에 반영할 승인 후보로 선택</label>
    </fieldset>
   </article>})}
   <div className="initial-apply"><p>승인한 후보를 한 번에 선택하세요. 반영 후 원본이 변경되므로 남은 후보는 재분석이 필요합니다.</p><button className="btn pri" disabled={blocked||!vm.checked.length||studio.dirty||studio.relationDirty} onClick={vm.apply}>선택한 {vm.checked.length}개를 세계관 초안에 반영</button></div>
  </>}
  {vm.receipt&&<p role="status">{vm.receipt.status==='applied'?`서버 반영 완료 기록: 설정 ${vm.receipt.createdCardIds.length}개 · 관계 ${vm.receipt.createdRelationshipIds.length}개`:vm.receipt.status==='failed'?'서버 반영 실패 · 최신 상태를 확인해 주세요.':'서버 반영 완료 미확인 · 같은 요청으로 확인해 주세요.'}</p>}
 </section>
}
function CandidateEdit({candidate,save}:{candidate:Candidate;save:(c:Candidate)=>Promise<void>}){
 const [title,setTitle]=useState(candidate.title),[text,setText]=useState(candidate.text),[condition,setCondition]=useState(candidate.condition),[timeText,setTimeText]=useState(candidate.timeText)
 const submit=(e:FormEvent)=>{e.preventDefault();void save({...candidate,title,text,condition,timeText,provenance:'author_revision',evidence:[]})}
 return <details><summary>내용 수정</summary><form onSubmit={submit}><label className="field">후보 이름<input className="inp" required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label><label className="field">후보 내용<textarea className="ta" required maxLength={3000} value={text} onChange={e=>setText(e.target.value)}/></label><label className="field">적용 조건<input className="inp" value={condition} onChange={e=>setCondition(e.target.value)}/></label><label className="field">이야기 속 시점<input className="inp" value={timeText} onChange={e=>setTimeText(e.target.value)}/></label><p className="small">수정 저장 후 검토 대기가 됩니다. 별도로 다시 승인해야 반영할 수 있어요.</p><button className="btn" type="submit">수정본 저장 · 재승인 필요</button></form></details>
}

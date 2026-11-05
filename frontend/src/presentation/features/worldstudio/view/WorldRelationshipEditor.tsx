import {cardTypes,cardTypeOf} from '../../../../domain/entities/studioCards'
import {useCallback,useEffect,useRef,useState} from 'react'
import {relationDefinitions,relationLabel,isFreeRelation,type RelationInput} from '../../../../domain/entities/studioRelations'
import type {useWorldStudioViewModel} from '../viewmodel/useWorldStudioViewModel'
type VM=ReturnType<typeof useWorldStudioViewModel>
type DraftRow={key:string;group:'fact'|'emotion';value:RelationInput;baseline?:RelationInput}
const pairMatches=(r:RelationInput,a:string,b:string)=>r.subjectId===a&&r.targetId===b||r.subjectId===b&&r.targetId===a
export function WorldRelationshipEditor({studio}:{studio:VM}){
 const people=studio.editing!.settings.filter(s=>cardTypes.some(type=>type.id===cardTypeOf(s.item)))
 const [source,setSource]=useState(''),[target,setTarget]=useState(''),[open,setOpen]=useState(false)
 const [focusRequest,setFocusRequest]=useState<{id:string;seq:number}|null>(null)
 const handledRequest=useRef(0)
 const [deleteConfirm,setDeleteConfirm]=useState<string|null>(null)
 const validDeletion=!!deleteConfirm&&people.some(s=>s.item.id===deleteConfirm&&s.item.kind==='entity'&&s.item.entityType==='character')
 const deletion=validDeletion?studio.personDeletionInfo(deleteConfirm!):null
 useEffect(()=>{if(deleteConfirm&&!validDeletion)setDeleteConfirm(null)},[deleteConfirm,validDeletion])
 const selectPair=useCallback((nextSource:string,nextTarget:string,nextOpen:boolean)=>{
  if(open&&(nextSource!==source||nextTarget!==target)&&!studio.confirmRelationDiscard())return false
  setSource(nextSource);setTarget(nextTarget);setOpen(nextOpen);return true
 },[open,source,target,studio])
 useEffect(()=>{
  const request=studio.relationRequest
  if(!request||request.seq===handledRequest.current)return
  handledRequest.current=request.seq
  const item=studio.editing?.settings.find(row=>row.item.id===request.id&&row.item.kind==='relation')?.item
  if(!item?.subjectId||!item.targetId)return
  if(open&&pairMatches(item,source,target)||selectPair(item.subjectId,item.targetId,true))setFocusRequest(request)
 },[studio.relationRequest,studio.editing?.settings,open,source,target,selectPair])
 const relations=studio.editing!.settings.filter(s=>s.item.kind==='relation')
 const name=(id:string|null)=>people.find(s=>s.item.id===id)?.item.title||'선택 안 함'
 return <section aria-label="관계 편집"><h3>관계 연결 (선택)</h3><p>구조적 관계와 방향별 감정을 따로 작성합니다.</p>
  <fieldset className="world-fields" disabled={studio.busy}><legend className="sr-only">관계 대상 선택</legend>
   <div className="world-form-row"><label className="field">source · 관계 주체<select className="inp" value={source} onChange={e=>selectPair(e.target.value,target,false)}><option value="">선택하세요</option>{people.map(s=><option key={s.item.id} value={s.item.id}>{s.item.title||'이름 없는 설정'}</option>)}</select></label>
   <label className="field">target · 관계 대상<select className="inp" value={target} onChange={e=>selectPair(source,e.target.value,false)}><option value="">선택하세요</option>{people.map(s=><option key={s.item.id} value={s.item.id}>{s.item.title||'이름 없는 설정'}</option>)}</select></label></div>
   <button className="btn" type="button" disabled={!source||!target||source===target} onClick={()=>setOpen(true)}>관계 작성</button>
   {people.length<2&&<p>설정 카드에서 설정 두 개을 먼저 추가하세요. 관계 없이도 저장할 수 있습니다.</p>}
   <div className="world-toolbar"><button className="btn" type="button" disabled={!people.some(s=>s.item.id===source&&s.item.entityType==='character')} onClick={()=>setDeleteConfirm(source)}>선택한 인물 삭제</button>
    {studio.canUndoPersonDeletion&&<button className="btn" type="button" onClick={()=>{if(open&&!studio.confirmRelationDiscard())return;const id=studio.undoPersonDeletion();if(id){setSource(id);setOpen(false)}}}>인물 삭제 되돌리기</button>}
   </div>
   {deletion&&<section aria-label="인물 삭제 확인"><h4>{deletion.person.item.title} 삭제 확인</h4><p>인물과 연결된 관계·감정 {deletion.relations.length}개를 편집본에서 삭제합니다. 저장해야 반영됩니다.</p><ul>{deletion.relations.map(r=><li key={r.item.id}>{relationLabel(r.item)}</li>)}</ul>
    {!!deletion.blockers.length&&<div role="alert"><p>다른 설정에서 참조하고 있어 삭제할 수 없습니다. 연결을 먼저 정리해 주세요.</p><ul>{deletion.blockers.map(row=><li key={row.item.id}>{row.item.title}</li>)}</ul></div>}
    <button className="btn" type="button" disabled={!!deletion.blockers.length} onClick={()=>{if(open&&!studio.confirmRelationDiscard())return;if(studio.deletePerson(deletion.person.item.id)){setDeleteConfirm(null);setSource('');setTarget('');setOpen(false)}}}>인물과 연결 삭제</button><button className="btn" type="button" onClick={()=>setDeleteConfirm(null)}>삭제 취소</button>
   </section>}
   {!relations.length&&<p>아직 연결한 관계가 없습니다.</p>}
   <nav aria-label="저장할 관계 목록">{relations.map(s=><button className="btn" key={s.item.id} type="button" onClick={()=>selectPair(s.item.subjectId??'',s.item.targetId??'',true)}>{name(s.item.subjectId)} · {relationLabel(s.item)} · {name(s.item.targetId)}</button>)}</nav>
   {open&&<PairEditor key={source+'|'+target} studio={studio} source={source} target={target} focusRequest={focusRequest} onClose={()=>setOpen(false)}/>}
  </fieldset>
 </section>
}

function PairEditor({studio,source,target,focusRequest,onClose}:{studio:VM;source:string;target:string;focusRequest:{id:string;seq:number}|null;onClose:()=>void}) {
 const focusedRow=useRef<HTMLDivElement>(null)
 useEffect(()=>{if(focusRequest)focusedRow.current?.querySelector<HTMLElement>('input,textarea,select')?.focus()},[focusRequest])
 const name=(id:string|null)=>studio.editing!.settings.find(s=>s.item.id===id)?.item.title||'새 설정'
 const empty=(group:'fact'|'emotion',from=source,to=target):DraftRow=>({key:crypto.randomUUID(),group,value:{subjectId:from,targetId:to,predicate:group==='fact'?'custom_relation':'custom_emotion',polarity:'asserted'}})
 const [rows,setRows]=useState<DraftRow[]>(()=>{
  const existing:DraftRow[]=studio.editing!.settings.filter(s=>s.item.kind==='relation'&&pairMatches(s.item,source,target)).map(s=>({key:s.item.id,group:relationDefinitions[s.item.predicate??'']?.group==='emotion'?'emotion' as const:'fact' as const,value:{...s.item},baseline:{...s.item}}))
  if(!existing.some(r=>r.group==='fact'))existing.push(empty('fact'))
  for(const [a,b] of [[source,target],[target,source]])if(!existing.some(r=>r.group==='emotion'&&r.value.subjectId===a))existing.push(empty('emotion',a,b))
  return existing
 })
 const [removed,setRemoved]=useState<string[]>([]),[error,setError]=useState('')
 const initialRows=useRef(JSON.stringify(rows))
 const {setRelationDirty}=studio
 useEffect(()=>{setRelationDirty(JSON.stringify(rows)!==initialRows.current||removed.length>0)},[rows,removed,setRelationDirty])
 useEffect(()=>()=>setRelationDirty(false),[setRelationDirty])
 const change=(key:string,patch:Partial<RelationInput>)=>{setRows(all=>all.map(r=>r.key===key?{...r,value:{...r.value,...patch}}:r));setError('')}
 const remove=(r:DraftRow)=>{if(r.value.id)setRemoved(ids=>[...ids,r.value.id!]);setRows(all=>all.filter(x=>x.key!==r.key))}
 const group=(kind:'fact'|'emotion',from:string,to:string,label:string)=>{
  const visible=rows.filter(r=>r.group===kind&&(kind==='fact'||r.value.subjectId===from))
  return <section className="relationship-group" key={label}><h4>{label}</h4>{visible.map((r,i)=>{
   const field=label+' '+(i+1),symmetric=!!relationDefinitions[r.value.predicate??'']?.symmetric
   const direction=symmetric?'mutual':r.value.subjectId===source?'forward':'reverse'
   const write=(text:string)=>change(r.key,{text,predicate:kind==='emotion'?'custom_emotion':symmetric?'custom_relation':'custom_relation_directed'})
   return <div className="relationship-row" key={r.key} ref={r.value.id===focusRequest?.id?focusedRow:undefined}>
    <label className="field">{field}{kind==='fact'?<input className="inp" list="relationship-examples" value={r.value.text??''} maxLength={3000} placeholder="예: 아버지와 서자, 인정받지 못한 가족" onChange={e=>write(e.target.value)}/>:<textarea className="ta" value={r.value.text??''} maxLength={3000} placeholder="예: 존경하고 인정받고 싶지만 차별에는 분노한다" onChange={e=>write(e.target.value)}/>}</label>
    {r.value.id&&!isFreeRelation(r.value.predicate)&&<p className="small muted">기존 관계: {relationLabel(r.value)}</p>}
    {kind==='fact'&&<><label className="field">{field} 방향<select className="inp" value={direction} onChange={e=>{
     const way=e.target.value
     const predicate=way==='mutual'?'custom_relation':isFreeRelation(r.value.predicate)||symmetric?'custom_relation_directed':r.value.predicate
     change(r.key,{predicate,subjectId:way==='reverse'?target:source,targetId:way==='reverse'?source:target})
    }}><option value="mutual">두 사람 사이의 관계</option><option value="forward">{name(source)} → {name(target)}</option><option value="reverse">{name(target)} → {name(source)}</option></select></label>
     {r.value.predicate==='parent_of'||r.value.predicate==='child_of'?<p className="small">{name(r.value.subjectId)}은(는) {name(r.value.targetId)}의 {r.value.predicate==='parent_of'?'부모':'자녀'}입니다.</p>:<p className="small muted">{direction==='mutual'?'두 사람의 관계를 자유롭게 적어 주세요.':`주체: ${name(r.value.subjectId)} · 대상: ${name(r.value.targetId)}. 누가 누구의 부모인지처럼 역할을 구체적으로 적어 주세요.`}</p>}
    </>}
    <label className="field">{field} 여부<select className="inp" value={r.value.polarity} onChange={e=>change(r.key,{polarity:e.target.value==='denied'?'denied':'asserted'})}><option value="asserted">해당함</option><option value="denied">해당하지 않음</option></select></label>
    {kind==='emotion'&&<button className="btn sm" type="button" onClick={()=>change(r.key,{subjectId:r.value.targetId,targetId:r.value.subjectId})}>{field} 방향 바꾸기</button>}
    <details><summary>항목 이름 직접 쓰기</summary>{r.value.title&&<p className="small">{r.value.title}</p>}<label className="field">{field} 이름<input className="inp" value={r.value.title??''} maxLength={200} placeholder="관계에 맞춰 자동으로 정해요" onChange={e=>change(r.key,{title:e.target.value})}/></label></details>
    <button className="btn sm relationship-remove" type="button" onClick={()=>remove(r)}>{field} 삭제</button>
   </div>
  })}<button className="btn sm" type="button" onClick={()=>setRows(all=>[...all,empty(kind,from,to)])}>{label} 추가</button></section>
 }
 const apply=()=>{
  const changes=rows.filter(r=>r.value.id||r.value.text?.trim()).map(r=>r.baseline?{...r.value,baseline:r.baseline}:r.value)
  if(!changes.length&&!removed.length){setError('실제 관계나 감정을 하나 이상 선택해 주세요.');return}
  if(studio.applyRelations(changes,removed))onClose();else setError('적용하지 못했습니다. 중복된 관계와 연결 대상, 이름·설명을 확인해 주세요.')
 }
 return <><datalist id="relationship-examples"><option value="친구"/><option value="아버지와 서자, 인정받지 못한 가족"/><option value="오랜 동료이자 경쟁자"/></datalist><p className="small muted">실제 관계는 여러 개일 수 있어요. 감정은 각 방향을 따로 정하며, 반대 방향으로 복사하지 않습니다.</p>
  {group('fact',source,target,'실제 관계')}{group('emotion',source,target,`${name(source)} → ${name(target)} 감정`)}{group('emotion',target,source,`${name(target)} → ${name(source)} 감정`)}
  {!!removed.length&&<p role="status">관계 항목 {removed.length}개를 삭제할 예정입니다. 다른 관계와 감정은 유지됩니다.</p>}
  {error&&<p role="alert" className="world-error">{studio.error||error}</p>}
  <div className="relationship-apply"><button type="button" className="btn pri" onClick={apply}>편집본에 적용</button><button type="button" className="btn" onClick={()=>{if(studio.confirmRelationDiscard())onClose()}}>취소</button></div><p className="small muted">적용 후 세계관 저장 버튼을 눌러야 저장됩니다. 취소하면 이 패널에서 입력한 변경만 버립니다.</p>
 </>
}

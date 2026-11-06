import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import { relationLabel, type RelationInput } from '../../../../domain/entities/studioRelations'
import { buildCharacterMap } from '../viewmodel/characterMap'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { MapBoundary } from './WorldMap'
import './world-map.css'

const Canvas=lazy(()=>import('./CharacterCards'))
type VM=ReturnType<typeof useWorldStudioViewModel>
type Selection={kind:'person';id:string}|{kind:'target';source:string}|{kind:'pair';source:string;target:string}|null
const pairMatches=(r:RelationInput,a:string,b:string)=>r.subjectId===a&&r.targetId===b||r.subjectId===b&&r.targetId===a

export function CharacterRelationshipEditor({studio,renderPair}:{studio:VM;renderPair:(source:string,target:string,onClose:()=>void)=>ReactNode}) {
 const settings=studio.editing!.settings,people=settings.filter(s=>s.item.kind==='entity'&&s.item.entityType==='character')
 const vm=useWorldMapViewModel(settings,buildCharacterMap)
 const selectMap=vm.select
 const [selection,setSelection]=useState<Selection>(()=>people.some(p=>p.item.id===studio.selected)?{kind:'person',id:studio.selected}:null),[layoutVersion,setLayoutVersion]=useState(0),[deleteConfirm,setDeleteConfirm]=useState<string|null>(null)
 const [narrow,setNarrow]=useState(()=>window.matchMedia?.('(max-width: 1050px)').matches??false)
 const inspector=useRef<HTMLElement>(null),peopleButtons=useRef(new Map<string,HTMLButtonElement>()),returnFocus=useRef<string|null>(null),addButton=useRef<HTMLButtonElement>(null)
 const name=(id:string)=>people.find(p=>p.item.id===id)?.item.title||'새 인물'
 const source=selection?.kind==='person'?selection.id:selection?.source??null
 const choosing=selection?.kind==='target'
 const person=selection?.kind==='person'?people.find(p=>p.item.id===selection.id):null
 const deletion=deleteConfirm&&person?studio.personDeletionInfo(person.item.id):null
 const showInspector=!!selection&&!choosing
 const pairRelations=selection?.kind==='pair'?settings.filter(s=>s.item.kind==='relation'&&pairMatches(s.item,selection.source,selection.target)):[]
 const pairs=Array.from(new Map(settings.filter(s=>s.item.kind==='relation'&&people.some(p=>p.item.id===s.item.subjectId)&&people.some(p=>p.item.id===s.item.targetId)).map(s=>{
  const [a,b]=[s.item.subjectId!,s.item.targetId!].sort();return [a+'|'+b,{a,b}]
 })).values())
 useEffect(()=>{
  const media=window.matchMedia?.('(max-width: 1050px)');if(!media)return
  const changed=()=>setNarrow(media.matches);media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed)
 },[])
 useEffect(()=>{if(!narrow||!showInspector)return;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=overflow}},[narrow,showInspector])
 useEffect(()=>{
  selectMap(source)
  if(returnFocus.current){(peopleButtons.current.get(returnFocus.current)??addButton.current)?.focus({preventScroll:true});returnFocus.current=null;return}
  if(selection?.kind==='target')Array.from(peopleButtons.current.entries()).find(([id,button])=>id!==selection.source&&!button.disabled)?.[1].focus({preventScroll:true})
  else if(selection)inspector.current?.focus({preventScroll:true})
 },[selection,source,selectMap])
 const beginConnection=(id:string)=>{if(studio.busy)return;vm.setQuery('');setDeleteConfirm(null);vm.select(id);setSelection({kind:'target',source:id})}
 const selectPerson=(id:string)=>{
  if(studio.busy)return
  setDeleteConfirm(null)
  if(selection?.kind==='target'){
   if(selection.source!==id)setSelection({kind:'pair',source:selection.source,target:id})
   return
  }
  vm.select(id);studio.setSelected(id);setSelection({kind:'person',id})
 }
 const openPair=(a:string,b:string)=>{if(studio.busy)return;vm.select(a);setSelection({kind:'pair',source:a,target:b})}
 const cancel=()=>{if(source)returnFocus.current=source;setDeleteConfirm(null);setSelection(null);vm.select(null)}
 const keyDown=(e:KeyboardEvent<HTMLElement>)=>{
  if(e.key==='Escape'&&selection){e.preventDefault();e.stopPropagation();cancel();return}
  if(e.key!=='Tab'||!narrow||!showInspector||!inspector.current)return
  const controls=Array.from(inspector.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')).filter(el=>el.getClientRects().length)
  const first=controls[0],last=controls.at(-1)
  if(e.shiftKey&&(document.activeElement===first||document.activeElement===inspector.current)){e.preventDefault();last?.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
 }
 return <section className="world-map relationship-editor" aria-label="인물 관계 편집" onKeyDown={keyDown}>
  <div className="world-map-intro"><h3>인물 관계 편집</h3><p>인물을 선택하고 연결할 상대를 고르세요. 관계와 서로의 감정은 따로 정할 수 있어요.</p></div>
  <fieldset className="world-fields" disabled={studio.busy}>
   <div className="relationship-toolbar"><button ref={addButton} type="button" className="btn pri" onClick={()=>{const id=studio.addCard('character');if(id){vm.select(id);setDeleteConfirm(null);setSelection({kind:'person',id})}}}>인물 추가</button>
    <label className="sr-only" htmlFor="relationship-search">인물 찾기</label><input id="relationship-search" type="search" className="inp" aria-label="인물 찾기" value={vm.query} onChange={e=>vm.setQuery(e.target.value)} placeholder="인물 찾기"/>
    <button type="button" className="btn" onClick={()=>setLayoutVersion(v=>v+1)}>배치 정돈</button>
   </div>
   {studio.canUndoPersonDeletion&&<p role="status" className="relationship-undo">인물과 연결을 편집본에서 삭제했습니다. 다음 수정이나 저장 전까지 되돌릴 수 있어요.<button type="button" className="btn sm" onClick={()=>{const id=studio.undoPersonDeletion();if(id)selectPerson(id)}}>인물 삭제 되돌리기</button></p>}
   <ol className="relationship-steps" aria-label="관계 연결 단계"><li aria-current={!selection||selection.kind==='person'?'step':undefined}>인물 선택</li><li aria-current={choosing?'step':undefined}>상대 선택</li><li aria-current={selection?.kind==='pair'?'step':undefined}>관계·감정 입력</li><li>편집본 적용 후 저장</li></ol>
   <div className="relationship-hint" role="status">{choosing?<><strong>{name(selection.source)}</strong>와 연결할 상대를 선택해 주세요.<button type="button" className="btn sm" onClick={cancel}>연결 취소</button></>:selection?.kind==='pair'?'관계 입력 중입니다. 편집본에 적용한 뒤 위의 저장 버튼을 눌러 주세요.':'인물은 드래그로 위치를 옮길 수 있어요. 연결은 인물을 선택한 뒤 시작하세요.'}</div>
   <div className={'relationship-workspace'+(showInspector?' has-inspector':'')}>
    <div className="relationship-main"><MapBoundary><Suspense fallback={<p role="status">관계도를 불러오고 있습니다.</p>}><Canvas vm={vm} editing={{busy:studio.busy,selectedRelations:pairRelations.map(r=>r.item.id),targetSource:choosing?selection.source:null,layoutVersion,onSelect:selectPerson,onConnect:beginConnection,onRelation:id=>{const r=settings.find(s=>s.item.id===id)?.item;if(r?.subjectId&&r.targetId)openPair(r.subjectId,r.targetId)}}}/></Suspense></MapBoundary>
     {!people.length&&<p className="relationship-empty">아직 인물이 없어요. 인물을 추가해 관계를 시작하세요.</p>}
     <div className="relationship-legend"><span>실선: 실제 관계</span><span>점선·화살표: 방향별 감정</span><span>위치는 이 화면에서만 유지돼요.</span></div>
     <nav className="relationship-people" aria-label="관계 편집 인물 목록">{vm.results.map(n=><button type="button" className="btn sm" key={n.id} ref={el=>{if(el)peopleButtons.current.set(n.id,el);else peopleButtons.current.delete(n.id)}} aria-label={`${n.name} 인물`} aria-pressed={source===n.id} disabled={choosing&&(n.id===selection.source||!people.find(p=>p.item.id===n.id)?.item.title.trim())} onClick={()=>selectPerson(n.id)}>{n.name}</button>)}</nav>
     {!vm.results.length&&!!people.length&&<p className="small muted">일치하는 인물이 없습니다. 검색어를 지워 다시 선택해 주세요.</p>}
     <nav className="relationship-pairs" aria-label="인물 관계 목록">{pairs.map(p=><button className="btn sm" key={p.a+'|'+p.b} type="button" aria-label={`${name(p.a)} · ${name(p.b)} 관계 편집`} onClick={()=>openPair(p.a,p.b)}>{name(p.a)} · {name(p.b)}<small>{settings.filter(s=>s.item.kind==='relation'&&pairMatches(s.item,p.a,p.b)).length}개 항목</small></button>)}</nav>
    </div>
    {narrow&&showInspector&&<button type="button" className="relationship-backdrop" tabIndex={-1} aria-label="선택 취소" onClick={cancel}/>}
    {showInspector&&<aside ref={inspector} tabIndex={-1} className="relationship-inspector" role={narrow?'dialog':undefined} aria-modal={narrow?true:undefined} aria-label="인물과 관계 편집">
     <div className="relationship-inspector-head"><h3>{person?'인물 정보':`${name(selection!.kind==='pair'?selection.source:'')} · ${name(selection!.kind==='pair'?selection.target:'')}`}</h3><button type="button" className="btn sm" aria-label="편집 패널 닫기" onClick={cancel}>닫기</button></div>
     {deletion?<><h4>{deletion.person.item.title} 삭제 확인</h4><p>이 인물과 아래 관계·감정 {deletion.relations.length}개를 편집본에서 삭제합니다. 공통 저장을 눌러야 반영되며 이전 저장 이력은 유지됩니다.</p><ul>{deletion.relations.map(r=><li key={r.item.id}>{relationLabel(r.item)}</li>)}</ul>
      {!!deletion.blockers.length&&<div role="alert"><p>다른 설정이 참조하고 있어 삭제할 수 없습니다. 먼저 해당 설정의 참조를 정리해 주세요.</p><ul>{deletion.blockers.map(s=><li key={s.item.id}>{s.item.title}</li>)}</ul></div>}
      <button type="button" className="btn relationship-remove" disabled={!!deletion.blockers.length} onClick={()=>{if(studio.deletePerson(deletion.person.item.id))cancel()}}>인물과 연결 삭제</button><button type="button" className="btn" onClick={()=>setDeleteConfirm(null)}>삭제 취소</button>
     </>:person?<><label className="field">인물 이름<input className="inp" value={person.item.title} maxLength={200} onChange={e=>studio.update(person.item.id,{title:e.target.value})}/></label><label className="field">인물 설명<textarea className="ta" value={person.item.text} maxLength={3000} onChange={e=>studio.update(person.item.id,{text:e.target.value})}/></label>
      <button type="button" className="btn pri" disabled={people.length<2||!person.item.title.trim()} onClick={()=>beginConnection(person.item.id)}>다른 인물과 연결하기</button>
      {!person.item.title.trim()&&<p className="small muted">이름을 입력한 뒤 다른 인물과 연결할 수 있어요.</p>}
      <p><button type="button" className="btn relationship-remove" onClick={()=>setDeleteConfirm(person.item.id)}>인물 삭제</button></p>
     </>:selection?.kind==='pair'?renderPair(selection.source,selection.target,cancel):null}
    </aside>}
   </div>
  </fieldset>
 </section>
}

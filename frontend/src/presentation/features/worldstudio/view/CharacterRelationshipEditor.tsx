import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { RelationInput } from '../../../../domain/entities/studioRelations'
import { buildCharacterMap } from '../viewmodel/characterMap'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { MapBoundary } from './WorldMap'
import { PersonDeletionConfirm } from './PersonDeletionConfirm'
import { RelationPairEditor } from './RelationPairEditor'
import './world-map.css'

const Canvas=lazy(()=>import('./CharacterCards'))
type VM=ReturnType<typeof useWorldStudioViewModel>
type Selection={kind:'person';id:string}|{kind:'target';source:string}|{kind:'pair';source:string;target:string}|null
const pairMatches=(r:RelationInput,a:string,b:string)=>r.subjectId===a&&r.targetId===b||r.subjectId===b&&r.targetId===a

export function CharacterRelationshipEditor({studio}:{studio:VM}) {
 const settings=studio.editing!.settings,people=settings.filter(s=>s.item.kind==='entity'&&s.item.entityType==='character')
 const vm=useWorldMapViewModel(settings,buildCharacterMap)
 const selectMap=vm.select
 const [selection,setSelection]=useState<Selection>(()=>people.some(p=>p.item.id===studio.selected)?{kind:'person',id:studio.selected}:null),[layoutVersion,setLayoutVersion]=useState(0),[deleteConfirm,setDeleteConfirm]=useState<string|null>(null)
 const [narrow,setNarrow]=useState(()=>window.matchMedia?.('(max-width: 1050px)').matches??false)
 const root=useRef<HTMLElement>(null),inspector=useRef<HTMLDialogElement>(null),returnFocus=useRef<string|null>(null),pairDirty=useRef(false),addButton=useRef<HTMLButtonElement>(null)
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
 useEffect(()=>{const d=inspector.current;if(!d||!showInspector)return;if(narrow)d.showModal();else d.show();return()=>d.close()},[narrow,showInspector])
 useEffect(()=>{
  selectMap(source)
  const find=(selector:string)=>root.current?.querySelector<HTMLElement>(selector)
  if(returnFocus.current){(find(`[data-id="${returnFocus.current}"] button`)??addButton.current)?.focus({preventScroll:true});returnFocus.current=null;return}
  if(selection?.kind==='target')find('.relationship-character-card.target button:not(:disabled)')?.focus({preventScroll:true})
  else if(selection)inspector.current?.focus({preventScroll:true})
 },[selection,source,selectMap])
 const beginConnection=(id:string)=>{if(studio.busy||!discardable())return;setDeleteConfirm(null);vm.select(id);setSelection({kind:'target',source:id})}
 const selectPerson=(id:string)=>{
  if(studio.busy)return
  setDeleteConfirm(null)
  if(selection?.kind==='target'){
   if(selection.source!==id)setSelection({kind:'pair',source:selection.source,target:id})
   return
  }
  if(!discardable())return
  vm.select(id);studio.setSelected(id);setSelection({kind:'person',id})
 }
 const openPair=(a:string,b:string)=>{if(studio.busy||!discardable())return;vm.select(a);setSelection({kind:'pair',source:a,target:b})}
 const close=()=>{if(source)returnFocus.current=source;pairDirty.current=false;setDeleteConfirm(null);setSelection(null);vm.select(null)}
 const discardable=()=>!(selection?.kind==='pair'&&pairDirty.current)||window.confirm('편집본에 적용하지 않은 관계 입력이 사라집니다. 계속할까요?')
 const dismiss=()=>{if(discardable())close()}
 const keyDown=(e:KeyboardEvent<HTMLElement>)=>{if(e.key==='Escape'&&selection&&!e.nativeEvent.isComposing){e.preventDefault();e.stopPropagation();dismiss()}}
 return <section ref={root} className="world-map relationship-editor" aria-label="인물 관계 편집" onKeyDown={keyDown}>
  <div className="world-map-intro"><h3>인물 관계 편집</h3><p>인물을 선택하고 연결할 상대를 고르세요. 관계와 서로의 감정은 따로 정할 수 있어요.</p></div>
  <fieldset className="world-fields" disabled={studio.busy}>
   <div className="relationship-toolbar"><button ref={addButton} type="button" className="btn pri" onClick={()=>{if(!discardable())return;const id=studio.addCard('character');if(id){vm.select(id);setDeleteConfirm(null);setSelection({kind:'person',id})}}}>인물 추가</button>
    <button type="button" className="btn" onClick={()=>setLayoutVersion(v=>v+1)}>배치 정돈</button>
   </div>
   {studio.canUndoPersonDeletion&&<p role="status" className="relationship-undo">인물과 연결을 편집본에서 삭제했습니다. 다음 수정이나 저장 전까지 되돌릴 수 있어요.<button type="button" className="btn sm" onClick={()=>{const id=studio.undoPersonDeletion();if(id)selectPerson(id)}}>인물 삭제 되돌리기</button></p>}
   <div className="relationship-hint" role="status">{choosing?<><strong>{name(selection.source)}</strong>와 연결할 상대를 선택해 주세요.<button type="button" className="btn sm" onClick={close}>연결 취소</button></>:selection?.kind==='pair'?'관계 입력 중입니다. 편집본에 적용한 뒤 위의 저장 버튼을 눌러 주세요.':'인물은 드래그로 위치를 옮길 수 있고 위치는 이 화면에서만 유지돼요. 연결은 인물을 선택한 뒤 시작하세요. 실선은 실제 관계, 점선·화살표는 방향별 감정이에요.'}</div>
   <div className={'relationship-workspace'+(showInspector?' has-inspector':'')}>
    <div className="relationship-main"><MapBoundary><Suspense fallback={<p role="status">관계도를 불러오고 있습니다.</p>}><Canvas key={layoutVersion} vm={vm} editing={{busy:studio.busy,selectedRelations:pairRelations.map(r=>r.item.id),targetSource:choosing?selection.source:null,onSelect:selectPerson,onConnect:beginConnection,onRelation:id=>{const r=settings.find(s=>s.item.id===id)?.item;if(r?.subjectId&&r.targetId)openPair(r.subjectId,r.targetId)}}}/></Suspense></MapBoundary>
     {!people.length&&<p className="relationship-empty">아직 인물이 없어요. 인물을 추가해 관계를 시작하세요.</p>}
     <nav className="relationship-pairs" aria-label="인물 관계 목록">{pairs.map(p=><button className="btn sm" key={p.a+'|'+p.b} type="button" aria-label={`${name(p.a)} · ${name(p.b)} 관계 편집`} onClick={()=>openPair(p.a,p.b)}>{name(p.a)} · {name(p.b)}<small>{settings.filter(s=>s.item.kind==='relation'&&pairMatches(s.item,p.a,p.b)).length}개 항목</small></button>)}</nav>
    </div>
    {showInspector&&<dialog ref={inspector} tabIndex={-1} className="relationship-inspector" aria-label="인물과 관계 편집" onCancel={e=>e.preventDefault()}>
     <div className="relationship-inspector-head"><h3>{person?'인물 정보':`${name(selection!.kind==='pair'?selection.source:'')} · ${name(selection!.kind==='pair'?selection.target:'')}`}</h3><button type="button" className="btn sm" aria-label="편집 패널 닫기" onClick={dismiss}>닫기</button></div>
     {deletion?<PersonDeletionConfirm deletion={deletion} onDelete={()=>{if(studio.deletePerson(deletion.person.item.id))close()}} onCancel={()=>setDeleteConfirm(null)}/>:person?<><label className="field">인물 이름<input className="inp" value={person.item.title} maxLength={200} onChange={e=>studio.update(person.item.id,{title:e.target.value})}/></label><label className="field">인물 설명<textarea className="ta" value={person.item.text} maxLength={3000} onChange={e=>studio.update(person.item.id,{text:e.target.value})}/></label>
      <button type="button" className="btn pri" disabled={people.length<2||!person.item.title.trim()} onClick={()=>beginConnection(person.item.id)}>다른 인물과 연결하기</button>
      {!person.item.title.trim()&&<p className="small muted">이름을 입력한 뒤 다른 인물과 연결할 수 있어요.</p>}
      <p><button type="button" className="btn relationship-remove" onClick={()=>setDeleteConfirm(person.item.id)}>인물 삭제</button></p>
     </>:selection?.kind==='pair'?<RelationPairEditor key={selection.source+'|'+selection.target} studio={studio} source={selection.source} target={selection.target} onClose={close} onDirty={dirty=>{pairDirty.current=dirty}}/>:null}
    </dialog>}
   </div>
  </fieldset>
 </section>
}

import {cardLibraryRows,selectCardForFilter,worldWritingIssues} from '../../../../domain/entities/worldStudioWriting'
import {initialWorldStudioFlow,worldStudioFlow,type StudioStep} from './worldStudioFlow'
import {applyRelationChanges,assertNoNewRelationDuplicates,editStudioSetting,personDeletionInfo,removePerson,type RelationInput} from '../../../../domain/entities/studioRelations'
import {cardTypePatch,areaPatch,type CardType} from '../../../../domain/entities/studioCards'
import { useContext, useEffect, useReducer, useRef, useState } from 'react'
import { WorldStudioLeaveContext } from './worldStudioLeaveGuard'
import { useNavigate, useParams } from 'react-router'
import { appContainer } from '../../../../app/appContainer'
import { newSetting, type SettingItem, type StudioSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'

export function useWorldStudioViewModel(useCase:WorldStudioUseCase=appContainer.resolve('worldStudioUseCase')) {
 const {worldId=''}=useParams()
 const navigate=useNavigate()
 const leaveGuard=useContext(WorldStudioLeaveContext)
 const [flow,dispatchFlow]=useReducer(worldStudioFlow,initialWorldStudioFlow)
 const [tool,setTool]=useState<'write'|'explore'|'analysis'>('write')
 const [explore,setExplore]=useState('map')
 const [cardFilter,setCardFilter]=useState<CardType|'all'>('all')
 const [cardQuery,setCardQuery]=useState('')
 const [newCardType,setNewCardType]=useState<CardType>('character')
 const [cardDetail,setCardDetail]=useState(false)
 const [relationWorld,setRelationWorld]=useState('')
 const [relationRequest,setRelationRequest]=useState<{id:string;seq:number}|null>(null)
 const [relationKey,setRelationKey]=useState(0)
 const returnCard=useRef('')
 const [saveState,setSaveState]=useState<'idle'|'saving'|'failed'>('idle')
 const [worlds,setWorlds]=useState<StudioWorld[]>([])
 const [saved,setSaved]=useState<StudioWorld|null>(null)
 const [editing,setEditing]=useState<StudioWorld|null>(null)
 const [personUndo,setPersonUndo]=useState<{worldId:string;id:string;before:StudioSetting[];after:StudioSetting[];wasDirty:boolean}|null>(null)
 const [dirty,setDirty]=useState(false)
 const [relationDirty,setRelationDirty]=useState(false)
 const [selected,setSelected]=useState('')
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [busy,setBusy]=useState(false)
 useEffect(()=>{leaveGuard?.setDirty(dirty);return ()=>leaveGuard?.setDirty(false)},[dirty,leaveGuard])
 useEffect(()=>{leaveGuard?.setRelationDirty(relationDirty);return ()=>leaveGuard?.setRelationDirty(false)},[relationDirty,leaveGuard])
 const editingId=editing?.id
 useEffect(()=>{
  if(editingId)dispatchFlow({type:'open'})
  setTool('write');setCardFilter('all');setCardQuery('');setCardDetail(false);setRelationWorld('');setRelationRequest(null);returnCard.current=''
 },[editingId])
 const goStep=(step:StudioStep)=>{dispatchFlow({type:'step',step});setTool('write');if(step==='relations'&&editing)setRelationWorld(editing.id)}
 const editCard=(id:string)=>{const row=editing?.settings.find(s=>s.item.id===id);if(row&&cardLibraryRows([row],'all','').length&&!cardLibraryRows([row],cardFilter,cardQuery).length){setCardFilter('all');setCardQuery('')};setSelected(id);setCardDetail(true);goStep('cards')}
 const filterCards=(type:CardType|'all',query:string)=>{setCardFilter(type);setCardQuery(query);setSelected(selectCardForFilter(editing?.settings??[],selected,type,query))}
 const generation=useRef(0)
 const pending=useRef(false)
 const install=(w:StudioWorld) => {setPersonUndo(null);setSaved(w);setEditing(structuredClone(w));setSaveState('idle');setDirty(false);setWorlds(ws=>[...ws.filter(x=>x.id!==w.id),w])}
 useEffect(()=>{
  const controller=new AbortController();const current=++generation.current
  setPersonUndo(null);setSaved(null);setEditing(null);setDirty(false);setError('');setMessage('');setBusy(true)
  Promise.all([useCase.list(controller.signal),worldId?useCase.read(worldId,controller.signal):Promise.resolve(null)]).then(([ws,w])=>{
   if(generation.current!==current)return
   setWorlds(ws);if(w){setSaved(w);setEditing(structuredClone(w))}
  }).catch(e=>{if(generation.current===current && !controller.signal.aborted)setError(e instanceof Error?e.message:'세계관을 읽지 못했습니다.')}).finally(()=>{if(generation.current===current)setBusy(false)})
  return ()=>{controller.abort();generation.current=current+1}
 },[useCase,worldId])
 useEffect(()=>{if(!dirty&&!relationDirty)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return ()=>window.removeEventListener('beforeunload',warn)},[dirty,relationDirty])
 const perform=async(action:()=>Promise<void>)=>{
  if(pending.current)return
  pending.current=true;const current=generation.current;setBusy(true);setError('');setMessage('')
  try {await action()} catch(e) {if(current===generation.current)setError(e instanceof Error?e.message:'요청하지 못했습니다. 입력은 유지됩니다.')} finally {pending.current=false;if(current===generation.current)setBusy(false)}
 }
 const apply=(w:StudioWorld,current:number)=>{if(generation.current===current)install(w)}
 const patch=(p:Partial<StudioWorld>)=>{setPersonUndo(null);setEditing(w=>w?{...w,...p}:null);setDirty(true);setMessage('')}
 const changeRelations=(change:(settings:StudioSetting[])=>StudioSetting[])=>{
  if(!editing||busy)return
  try {const settings=change(editing.settings);if(settings!==editing.settings)patch({settings});setError('');return settings} catch(e) {setError(e instanceof Error?e.message:'관계를 변경하지 못했습니다.')}
 }
 return {canUndoPersonDeletion:!!personUndo,flow,tool,setTool,explore,setExplore,cardFilter,setCardFilter,cardQuery,setCardQuery,filterCards,newCardType,setNewCardType,cardDetail,setCardDetail,relationWorld,relationKey,relationRequest,goStep,editCard,saveState,
  showList:()=>dispatchFlow({type:'list'}),resume:()=>dispatchFlow({type:'resume'}),
  openRelations:(id:string)=>{returnCard.current=id;setSelected(id);goStep('relations')},
  editRelation:(id:string)=>{setRelationRequest(previous=>({id,seq:(previous?.seq??0)+1}));goStep('relations')},
  returnToCard:()=>{if(returnCard.current)setSelected(returnCard.current);setCardDetail(true);goStep('cards')},
  cardRows:cardLibraryRows(editing?.settings??[],cardFilter,cardQuery),writingIssues:editing?worldWritingIssues(editing):[],
  worlds,saved,editing,dirty,relationDirty,setRelationDirty,selected,setSelected,error,message,busy,
  confirmRelationDiscard:()=>leaveGuard?leaveGuard.confirmRelationDiscard():!relationDirty||window.confirm('적용하지 않은 관계 입력을 버릴까요?'),
  create:(name:string,description:string)=>perform(async()=>{if(leaveGuard?!leaveGuard.confirmBeforeAction():(dirty||relationDirty)&&!window.confirm('저장하지 않은 변경이 있습니다. 새 세계관을 만들까요?'))return;const current=generation.current;const w=await useCase.create(name,description);if(generation.current===current){leaveGuard?.allowNextNavigation();navigate('/worldstudio/'+w.id)}}),
  open:(id:string)=>{if(leaveGuard?!leaveGuard.confirmBeforeAction():(dirty||relationDirty)&&!window.confirm('저장하지 않은 변경이 있습니다. 이동할까요?'))return;if(id!==worldId){leaveGuard?.allowNextNavigation();navigate('/worldstudio/'+id);return};return perform(async()=>{const current=generation.current;const world=await useCase.read(id);if(generation.current===current){setRelationKey(key=>key+1);setRelationDirty(false);apply(world,current)}})},
  patch,
  applyRelations:(changes:RelationInput[],removed:string[])=>!!changeRelations(settings=>applyRelationChanges(settings,changes,removed,saved?.settings)),
  personDeletionInfo:(id:string)=>personDeletionInfo(editing?.settings??[],id),
  deletePerson:(id:string)=>{if(!editing)return false;const before=editing.settings;const after=changeRelations(settings=>removePerson(settings,id));if(!after)return false;setPersonUndo({worldId:editing.id,id,before,after,wasDirty:dirty});return true},
  undoPersonDeletion:()=>{if(!editing||!personUndo||busy||editing.id!==personUndo.worldId||editing.settings!==personUndo.after)return;const id=personUndo.id;patch({settings:personUndo.before});setDirty(personUndo.wasDirty);setSelected(id);return id},
  addCard:(type:CardType|'note')=>{if(!editing||busy)return;const s=newSetting();if(type==='note')s.item.kind='note';else Object.assign(s.item,cardTypePatch(s.item,type,[]));patch({settings:[...editing.settings,s]});setSelected(s.item.id)},
  changeCardType:(id:string,type:CardType)=>{if(!editing||busy)return;const row=editing.settings.find(s=>s.item.id===id);if(!row)return;setSelected(id);try{const change=cardTypePatch(row.item,type,editing.settings);if(Object.keys(change).length)patch({settings:editStudioSetting(editing.settings,id,change)});setError('')}catch(e){setError(e instanceof Error?e.message:'유형을 바꾸지 못했습니다.')}},
  changeArea:(id:string,category:SettingItem['category'])=>{if(!editing||busy)return;const row=editing.settings.find(s=>s.item.id===id);if(!row)return;try{const change=areaPatch(row.item,category);patch({settings:editing.settings.map(s=>s.item.id===id?{...s,item:{...s.item,...change}}:s)});setError('')}catch(e){setError(e instanceof Error?e.message:'영역을 바꾸지 못했습니다.')}},
  update:(id:string,item:Partial<SettingItem>,labels?:Partial<StudioSetting>)=>{if(editing)patch({settings:editStudioSetting(editing.settings,id,item,labels)})},
  save:()=>perform(async()=>{if(!editing)return;const current=generation.current;setSaveState('saving');try{if(saved&&saved.id===editing.id)assertNoNewRelationDuplicates(editing.settings,saved.settings);apply(await useCase.save(editing),current);if(current===generation.current)setMessage('이 탭의 메모리에 저장했어요. 새로고침하면 초기화됩니다.')}catch(e){if(current===generation.current)setSaveState('failed');throw e}}),
 }
}

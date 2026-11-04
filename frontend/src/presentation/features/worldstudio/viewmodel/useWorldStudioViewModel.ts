import {cardTypePatch,areaPatch,type CardType} from '../../../../domain/entities/studioCards'
import type { StudioSection } from '../../../../domain/entities/studioSections'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { appContainer } from '../../../../app/appContainer'
import { authorEdit, newSetting, type SettingItem, type StudioSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'

export function useWorldStudioViewModel(useCase:WorldStudioUseCase=appContainer.resolve('worldStudioUseCase')) {
 const {worldId=''}=useParams()
 const navigate=useNavigate()
 const [worlds,setWorlds]=useState<StudioWorld[]>([])
 const [saved,setSaved]=useState<StudioWorld|null>(null)
 const [editing,setEditing]=useState<StudioWorld|null>(null)
 const [dirty,setDirty]=useState(false)
 const [selected,setSelected]=useState('')
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [busy,setBusy]=useState(false)
 const generation=useRef(0)
 const pending=useRef(false)
 const install=(w:StudioWorld) => {setSaved(w);setEditing(structuredClone(w));setDirty(false);setWorlds(ws=>[...ws.filter(x=>x.id!==w.id),w])}
 useEffect(()=>{
  const controller=new AbortController();const current=++generation.current
  setSaved(null);setEditing(null);setDirty(false);setError('');setMessage('');setBusy(true)
  Promise.all([useCase.list(controller.signal),worldId?useCase.read(worldId,controller.signal):Promise.resolve(null)]).then(([ws,w])=>{
   if(generation.current!==current)return
   setWorlds(ws);if(w){setSaved(w);setEditing(structuredClone(w))}
  }).catch(e=>{if(generation.current===current && !controller.signal.aborted)setError(e instanceof Error?e.message:'세계관을 읽지 못했습니다.')}).finally(()=>{if(generation.current===current)setBusy(false)})
  return ()=>{controller.abort();generation.current=current+1}
 },[useCase,worldId])
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return ()=>window.removeEventListener('beforeunload',warn)},[dirty])
 const perform=async(action:()=>Promise<void>)=>{
  if(pending.current)return
  pending.current=true;const current=generation.current;setBusy(true);setError('');setMessage('')
  try {await action()} catch(e) {if(current===generation.current)setError(e instanceof Error?e.message:'요청하지 못했습니다. 입력은 유지됩니다.')} finally {pending.current=false;if(current===generation.current)setBusy(false)}
 }
 const apply=(w:StudioWorld,current:number)=>{if(generation.current===current)install(w)}
 const patch=(p:Partial<StudioWorld>)=>{setEditing(w=>w?{...w,...p}:null);setDirty(true);setMessage('')}
 return {worlds,saved,editing,dirty,selected,setSelected,error,message,busy,
  create:(name:string,description:string)=>perform(async()=>{const current=generation.current;const w=await useCase.create(name,description);if(generation.current===current)navigate('/worlds/'+w.id)}),
  open:(id:string)=>{if(dirty && !window.confirm('저장하지 않은 변경이 있습니다. 이동할까요?'))return;if(id!==worldId){navigate('/worlds/'+id);return};return perform(async()=>{const current=generation.current;apply(await useCase.read(id),current)})},
  patch,
  add:(section:StudioSection='basic')=>{if(!editing||busy)return;const s=newSetting(section);patch({settings:[...editing.settings,s]});setSelected(s.item.id);return s.item.id},
  addCard:(type:CardType|'note')=>{if(!editing||busy)return;const s=newSetting();if(type==='note')s.item.kind='note';else Object.assign(s.item,cardTypePatch(s.item,type,[]));patch({settings:[...editing.settings,s]});setSelected(s.item.id)},
  changeCardType:(id:string,type:CardType)=>{if(!editing||busy)return;const row=editing.settings.find(s=>s.item.id===id);if(!row)return;setSelected(id);try{const change=cardTypePatch(row.item,type,editing.settings);if(Object.keys(change).length)patch({settings:editing.settings.map(s=>s.item.id===id?authorEdit(s,change):s)});setError('')}catch(e){setError(e instanceof Error?e.message:'유형을 바꾸지 못했습니다.')}},
  changeArea:(id:string,category:SettingItem['category'])=>{if(!editing||busy)return;const row=editing.settings.find(s=>s.item.id===id);if(!row)return;try{const change=areaPatch(row.item,category);patch({settings:editing.settings.map(s=>s.item.id===id?{...s,item:{...s.item,...change}}:s)});setError('')}catch(e){setError(e instanceof Error?e.message:'영역을 바꾸지 못했습니다.')}},
  update:(id:string,item:Partial<SettingItem>,labels?:Partial<StudioSetting>)=>{if(editing)patch({settings:editing.settings.map(s=>s.item.id===id?{...authorEdit(s,item),...labels}:s)})},
  save:()=>{return perform(async()=>{if(!editing)return;const current=generation.current;apply(await useCase.save(editing),current);if(current===generation.current)setMessage('이 탭의 메모리에 저장했어요. 새로고침하면 초기화됩니다.')})},
 }
}

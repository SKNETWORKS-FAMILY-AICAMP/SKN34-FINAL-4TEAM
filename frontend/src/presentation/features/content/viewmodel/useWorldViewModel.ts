import {useCallback, useEffect, useRef, useState} from 'react'
import {appContainer} from '../../../../app/appContainer'
import type {EpisodeUseCase} from '../../../../domain/usecases/EpisodeUseCase'
import type {SettingInput, World} from '../../../../domain/entities/content'

const blank:SettingInput={name:'',content:'',category:'규칙',tags:[],visibility:'private',fromEpisode:1,toEpisode:null,knownBy:[],evidence:''}
function editable(value:SettingInput):SettingInput {
 return {name:value.name,content:value.content,category:value.category,tags:value.tags,visibility:value.visibility,fromEpisode:value.fromEpisode,toEpisode:value.toEpisode,knownBy:value.knownBy,evidence:value.evidence}
}
export function useWorldViewModel(workId:string, useCase:EpisodeUseCase=appContainer.resolve('episodeUseCase')) {
 const [world,setWorld]=useState<World|null>(null)
 const [form,setForm]=useState<SettingInput>(blank)
 const [sid,setSid]=useState('new')
 const [dirty,setDirty]=useState(false)
 const [busy,setBusy]=useState(false)
 const [editingLocked,setEditingLocked]=useState(false)
 const editRevision=useRef(0)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const inFlight=useRef(false)
 const alive=useRef(true)
 const selectedId=useRef('new')
 const install=useCallback((state:World,preserveInput=false)=>{
  setWorld(state)
  const selected=state.draft??state.settings.find(s=>s.id===selectedId.current)
  if(selected){if(!preserveInput)setForm(editable(selected));setSid(selected.id);selectedId.current=selected.id}
  if(!preserveInput)setDirty(false)
 },[])
 useEffect(()=>{
  alive.current=true
  useCase.world(workId).then(w=>{if(alive.current)install(w)}).catch(e=>{if(alive.current)setError(e.message)})
  return ()=>{alive.current=false}
 },[workId,useCase,install])
 const execute=useCallback(async(action:()=>Promise<World>,message:string,lockEditing=true)=>{
  if(inFlight.current)return
  inFlight.current=true;setBusy(true);setError('')
  setEditingLocked(lockEditing)
  const sentRevision=editRevision.current
  try{const w=await action();if(alive.current){const newerInput=sentRevision!==editRevision.current;install(w,newerInput);setNotice(newerInput?'':message)}}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'설정 저장에 실패했어요.')}
  finally{inFlight.current=false;if(alive.current){setBusy(false);setEditingLocked(false)}}
 },[install])
 const saveDraft=useCallback(()=>{
  if(!world||!dirty||!form.name.trim()||!form.content.trim())return
  return execute(()=>useCase.saveSetting(workId,sid,world.revision,form,world.sourceToken),'설정 초안 자동저장됨',false)
 },[world,dirty,form,execute,useCase,workId,sid])
 useEffect(()=>{
  if(!dirty||busy||error)return
  const timer=setTimeout(()=>{void saveDraft()},700)
  return ()=>clearTimeout(timer)
 },[dirty,busy,error,saveDraft])
 useEffect(()=>{
  const leave=(event:BeforeUnloadEvent)=>{if(dirty||busy)event.preventDefault()}
  window.addEventListener('beforeunload',leave)
  return ()=>window.removeEventListener('beforeunload',leave)
 },[dirty,busy])
 const pick=(value:SettingInput & {id:string})=>{
  if(busy)return
  if(dirty&&!window.confirm('아직 서버에 저장하지 않은 설정 편집을 버릴까요?'))return
  setForm(editable(value));setSid(value.id);selectedId.current=value.id;setDirty(false);setNotice('');setError('')
 }
 return {world,form,sid,dirty,busy,editingLocked,error,notice,
  edit:(patch:Partial<SettingInput>)=>{if(editingLocked)return;editRevision.current++;setForm(v=>({...v,...patch}));setDirty(true);setError('');setNotice('')},
  pick,newSetting:()=>pick({...blank,id:'new'}),saveDraft,
  reload:()=>execute(()=>useCase.world(workId),'최신 설정집을 불러왔어요.'),
  commit:()=>{if(world&&!dirty&&world.drafts.some(d=>d.id===sid))void execute(()=>useCase.commitSetting(workId,sid,world.revision),'새 설정 버전으로 확정했어요. 공개 범위는 지정한 회차에만 적용돼요.')},
  revert:(id:string,versionId:string)=>{if(world&&!dirty)void execute(()=>useCase.revertSetting(workId,id,world.revision,versionId),'과거 설정을 새 버전으로 복원했어요.')},
  decide:(changeId:string,decision:'apply'|'reject')=>{if(world&&!dirty)void execute(()=>useCase.decideChange(workId,world.revision,changeId,decision),decision==='apply'?'원본 변경을 새 설정 버전으로 반영했어요.':'이번 변경을 보류했어요. 나중에 다시 반영할 수 있어요.')},
 }
}

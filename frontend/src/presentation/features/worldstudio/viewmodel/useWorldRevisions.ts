import {useEffect,useRef,useState} from 'react'
import {useAppSelector} from '../../../../app/store'
import {appContainer} from '../../../../app/appContainer'
import type {WorldStudioUseCase} from '../../../../domain/usecases/WorldStudioUseCase'
import type {InitialWorldUseCase} from '../../../../domain/usecases/InitialWorldUseCase'
import type {StudioWorld,WorldRevision,WorldRevisionSummary} from '../../../../domain/entities/studioWorld'
export function useWorldRevisions(world:string,active:boolean,saved:StudioWorld|null,dirty:boolean,reload:()=>Promise<StudioWorld>,lock:(v:boolean)=>void,useCase:WorldStudioUseCase=appContainer.resolve('worldStudioUseCase'),ai:InitialWorldUseCase|null=appContainer.resolve('initialWorldUseCase')){
 const member=useAppSelector(s=>s.session.memberId),[rows,setRows]=useState<WorldRevisionSummary[]>([]),[detail,setDetail]=useState<WorldRevision|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(false),[aiPending,setAiPending]=useState(false)
 const [superseded,setSuperseded]=useState<{key:string;expectedDraftRevision:number;revisionId:string;revisionNo:number;currentRevisionNo:number}|null>(null)
 const request=useRef<AbortController|null>(null),generation=useRef(0)
 const inspect=()=>{setPending(!!useCase.pendingConfirmation(world));setAiPending(!!ai?.pending(world))}
 useEffect(()=>{
  const scope=++generation.current;setSuperseded(null);setRows([]);setDetail(null);setError('');setMessage('');setPending(false);setAiPending(false)
  if(!active||!member||!world||!useCase.supportsRevisions)return
  const c=new AbortController();request.current=c;setBusy(true)
  useCase.revisions(world,c.signal).then(data=>{if(scope===generation.current){setRows(data);inspect()}}).catch(e=>{if(scope===generation.current)setError(e instanceof Error?e.message:'확정 버전을 조회하지 못했어요.')}).finally(()=>{if(scope===generation.current){request.current=null;setBusy(false)}})
  return()=>{++generation.current;c.abort();request.current?.abort();request.current=null;lock(false)}
 },[world,member,active,useCase,ai,lock])
 const run=async(action:(signal:AbortSignal)=>Promise<void>,confirmation=false)=>{
  if(request.current)return;const c=new AbortController(),scope=generation.current;request.current=c;setBusy(true);lock(true);setError('');setMessage('')
  try{
   if(confirmation){
    if(!active||!member||!navigator.locks)throw new Error('로그인과 브라우저 요청 잠금 상태를 확인해 주세요.')
    // Repository POST lock is separate: this covers verification and acknowledgement across tabs too.
    await navigator.locks.request(`storyfork:confirmation-ui:${member}:${world}`,{ifAvailable:true},async held=>{
     if(!held)throw new Error('다른 탭에서 확정 결과를 확인 중이에요. 잠시 후 다시 확인해 주세요.')
     if(!c.signal.aborted)await action(c.signal)
    })
   }else await action(c.signal)
  }catch(e){if(scope===generation.current){if(confirmation)setSuperseded(null);setError(e instanceof Error?e.message:'확정 상태를 확인하지 못했어요.')}}
  finally{if(scope===generation.current){try{inspect()}catch{setPending(true)}setBusy(false);lock(false);request.current=null}}
 }
 const checkInput=()=>{
  if(dirty||!saved)throw new Error('현재 초안을 먼저 저장해 주세요.')
  if(ai?.pending(world))throw new Error('미확인 AI 요청이 있어요. 후보 검토 화면에서 먼저 확인해 주세요.')
 }
 const checkRequest=(key:string,expected:number)=>{
  const pending=useCase.pendingConfirmation(world)
  if(pending?.key!==key||pending.expectedDraftRevision!==expected)throw new Error('다른 탭에서 요청 상태가 변경됐어요. 같은 요청으로 다시 확인해 주세요.')
 }
 const verify=async(id:string,expected:number,signal:AbortSignal)=>{
  const verified=await useCase.revision(world,id,signal)
  if(verified.worldId!==world||verified.revisionId!==id)throw new Error('원래 확정 버전을 확인하지 못했어요.')
  signal.throwIfAborted()
  const latest=await reload()
  signal.throwIfAborted()
  const data=await useCase.revisions(world,signal)
  signal.throwIfAborted()
  const original=data.find(r=>r.worldId===world&&r.revisionId===id&&r.revisionNo===verified.revisionNo)
  const current=data.find(r=>r.worldId===world&&r.revisionId===latest.currentRevisionId)
  if(latest.id!==world||latest.version<expected+1||!original||!current||current.revisionNo<verified.revisionNo)throw new Error('확정 후 상세·목록·최신 초안을 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.')
  return {verified,data,current}
 }
 return {rows,detail,busy,error,message,pending,aiPending,superseded,supported:useCase.supportsRevisions,
  open:(id:string)=>run(async signal=>{const value=await useCase.revision(world,id,signal);if(!signal.aborted)setDetail(value)}),
  refresh:()=>run(async signal=>{if(dirty)throw new Error('작성 중인 입력을 먼저 저장해 주세요.');await reload();const data=await useCase.revisions(world,signal);if(!signal.aborted)setRows(data)}),
  confirm:(recover=false)=>run(async signal=>{
   checkInput();setSuperseded(null)
   const previous=useCase.pendingConfirmation(world)
   if(previous&&!recover)throw new Error('확정 결과가 미확인이에요. 같은 요청으로 확인해 주세요.')
   // Recovery must never create a new key if another tab already acknowledged the old request.
   if(recover&&!previous)throw new Error('원래 요청 기록이 없어요. 최신 저장 상태를 확인해 주세요.')
   const expected=previous?.expectedDraftRevision??saved!.version
   const created=await useCase.confirm(world,expected,signal)
   signal.throwIfAborted()
   const pending=useCase.pendingConfirmation(world)
   if(created.worldId!==world||!pending)throw new Error('원래 확정 요청을 확인하지 못했어요.')
   checkRequest(previous?.key??pending.key,expected)
   const {verified,data,current}=await verify(created.revisionId,expected,signal)
   checkRequest(pending.key,expected)
   setRows(data);setDetail(verified)
   if(current.revisionId!==verified.revisionId){
    setSuperseded({...pending,revisionId:verified.revisionId,revisionNo:verified.revisionNo,currentRevisionNo:current.revisionNo})
   }else{
    useCase.acknowledgeConfirmation(world);setMessage(`확정 버전 ${verified.revisionNo}을 저장했어요. 작품 공개나 회차 발행은 하지 않았어요.`)
   }
  },true),
  acknowledgeSuperseded:()=>run(async signal=>{
   checkInput()
   if(!superseded)throw new Error('원래 확정 결과를 먼저 확인해 주세요.')
   checkRequest(superseded.key,superseded.expectedDraftRevision)
   const {verified,data}=await verify(superseded.revisionId,superseded.expectedDraftRevision,signal)
   checkRequest(superseded.key,superseded.expectedDraftRevision)
   useCase.acknowledgeConfirmation(world)
   setSuperseded(null);setRows(data);setDetail(verified)
   setMessage('확정 저장 결과를 확인했어요. 최신 저장된 초안에서 계속 작성하거나 새 확정을 시작할 수 있어요.')
  },true),
 }
}

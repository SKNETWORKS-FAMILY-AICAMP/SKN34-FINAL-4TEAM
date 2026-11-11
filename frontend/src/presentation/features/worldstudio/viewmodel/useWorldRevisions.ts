import {useEffect,useRef,useState} from 'react'
import {useAppSelector} from '../../../../app/store'
import {appContainer} from '../../../../app/appContainer'
import type {WorldStudioUseCase} from '../../../../domain/usecases/WorldStudioUseCase'
import type {InitialWorldUseCase} from '../../../../domain/usecases/InitialWorldUseCase'
import type {StudioWorld,WorldRevision,WorldRevisionSummary} from '../../../../domain/entities/studioWorld'
export function useWorldRevisions(world:string,active:boolean,saved:StudioWorld|null,dirty:boolean,reload:()=>Promise<StudioWorld>,lock:(v:boolean)=>void,useCase:WorldStudioUseCase=appContainer.resolve('worldStudioUseCase'),ai:InitialWorldUseCase|null=appContainer.resolve('initialWorldUseCase')){
 const member=useAppSelector(s=>s.session.memberId),[rows,setRows]=useState<WorldRevisionSummary[]>([]),[detail,setDetail]=useState<WorldRevision|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(false),[aiPending,setAiPending]=useState(false)
 const request=useRef<AbortController|null>(null),generation=useRef(0)
 const inspect=()=>{setPending(!!useCase.pendingConfirmation(world));setAiPending(!!ai?.pending(world))}
 useEffect(()=>{
  const scope=++generation.current;setRows([]);setDetail(null);setError('');setMessage('');setPending(false);setAiPending(false)
  if(!active||!member||!world||!useCase.supportsRevisions)return
  const c=new AbortController();request.current=c;setBusy(true)
  useCase.revisions(world,c.signal).then(data=>{if(scope===generation.current){setRows(data);inspect()}}).catch(e=>{if(scope===generation.current)setError(e instanceof Error?e.message:'확정 버전을 조회하지 못했어요.')}).finally(()=>{if(scope===generation.current){request.current=null;setBusy(false)}})
  return()=>{++generation.current;c.abort();request.current?.abort();request.current=null;lock(false)}
 },[world,member,active,useCase,ai,lock])
 const run=async(action:(signal:AbortSignal)=>Promise<void>)=>{
  if(request.current)return;const c=new AbortController(),scope=generation.current;request.current=c;setBusy(true);lock(true);setError('');setMessage('')
  try{await action(c.signal)}catch(e){if(scope===generation.current)setError(e instanceof Error?e.message:'확정 상태를 확인하지 못했어요.')}
  finally{if(scope===generation.current){try{inspect()}catch{setPending(true)}setBusy(false);lock(false);request.current=null}}
 }
 return {rows,detail,busy,error,message,pending,aiPending,supported:useCase.supportsRevisions,
  open:(id:string)=>run(async signal=>{const value=await useCase.revision(world,id,signal);if(!signal.aborted)setDetail(value)}),
  refresh:()=>run(async signal=>{if(dirty)throw new Error('작성 중인 입력을 먼저 저장해 주세요.');await reload();const data=await useCase.revisions(world,signal);if(!signal.aborted)setRows(data)}),
  confirm:(recover=false)=>run(async signal=>{
   if(dirty||!saved)throw new Error('현재 초안을 먼저 저장해 주세요.')
   if(ai?.pending(world))throw new Error('미확인 AI 요청이 있습니다. 후보 검토 화면에서 먼저 확인해 주세요.')
   const previous=useCase.pendingConfirmation(world)
   if(previous&&!recover)throw new Error('확정 결과가 미확인입니다. 같은 요청으로 확인해 주세요.')
   const expected=previous?.expectedDraftRevision??saved.version
   const created=await useCase.confirm(world,expected,signal)
   const verified=await useCase.revision(world,created.revisionId,signal)
   if(signal.aborted)return
   const latest=await reload()
   if(latest.version<expected+1||!latest.currentRevisionId)throw new Error('확정 후 최신 초안 상태를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.')
   const data=await useCase.revisions(world,signal)
   if(signal.aborted)return
   if(!data.some(r=>r.revisionId===verified.revisionId))throw new Error('확정 버전 목록을 확인하지 못했어요.')
   useCase.acknowledgeConfirmation(world);setRows(data);setDetail(verified);setMessage(`확정 버전 ${verified.revisionNo}을 저장했습니다. 작품 공개나 회차 발행은 하지 않았습니다.`)
  }),
 }
}

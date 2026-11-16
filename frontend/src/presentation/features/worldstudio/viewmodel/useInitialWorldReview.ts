import {useEffect,useRef,useState} from 'react'
import {useAppSelector} from '../../../../app/store'
import {appContainer} from '../../../../app/appContainer'
import type {InitialWorldUseCase} from '../../../../domain/usecases/InitialWorldUseCase'
import {currentCandidate,type Analysis,type Candidate,type Receipt,type ReviewAction,type MutationResult} from '../../../../domain/entities/initialWorld'
export function useInitialWorldReview(world:string,active:boolean,dirty:boolean,revision:number|undefined,reload:(receipt:Receipt)=>Promise<unknown>,lock:(value:boolean)=>void,useCase:InitialWorldUseCase|null=appContainer.resolve('initialWorldUseCase')){
 const member=useAppSelector(s=>s.session.memberId),[analyses,setAnalyses]=useState<Analysis[]>([]),[selected,setSelected]=useState('')
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(false),[receipt,setReceipt]=useState<Receipt|null>(null)
 const controller=useRef<AbortController|null>(null),scope=useRef(0)
 const analysis=analyses.find(a=>a.analysisId===selected)??analyses.at(0) // 분석이 없으면 undefined
 useEffect(()=>{
  const generation=++scope.current;setAnalyses([]);setSelected('');setReceipt(null);setPending(false);setError('');setMessage('')
  if(!useCase||!world||!member||!active)return
  const c=new AbortController();controller.current=c;setBusy(true)
  useCase.list(world,c.signal).then(rows=>{if(scope.current!==generation)return;setAnalyses(rows);setPending(!!useCase.pending(world))}).catch(e=>{if(scope.current===generation)setError(e instanceof Error?e.message:'분석을 조회하지 못했어요.')}).finally(()=>{if(scope.current===generation){setBusy(false);controller.current=null}})
  return()=>{++scope.current;c.abort();controller.current?.abort();controller.current=null;lock(false)}
 },[world,member,active,useCase,lock])
 const run=async(action:(signal:AbortSignal)=>Promise<void>)=>{
  if(!useCase||controller.current)return
  const c=new AbortController(),generation=scope.current;controller.current=c;setBusy(true);lock(true);setError('');setMessage('')
  try{await action(c.signal)}catch(e){if(scope.current===generation)setError(e instanceof Error?e.message:'결과를 확인하지 못했어요.')}
  finally{if(scope.current===generation){try{setPending(!!useCase.pending(world))}catch{setPending(true)}finally{setBusy(false);lock(false);controller.current=null}}}
 }
 const refresh=async(signal:AbortSignal)=>{const rows=await useCase!.list(world,signal);if(!signal.aborted)setAnalyses(rows)}
 const result=async(r:MutationResult,signal:AbortSignal)=>{
  if(signal.aborted)return
  if('applicationId'in r){
   if(r.status!=='applied')setReceipt(r)
   if(r.status==='applied'){
    const p=useCase!.pending(world),analysisId=p?.path.split('/')[1]??analysis?.analysisId
    if(!analysisId)throw new Error('반영 조회 위치를 확인하지 못했어요.')
    const verified=await useCase!.receipt(world,analysisId,r.applicationId,signal)
    if(verified.status!=='applied')throw new Error('반영 완료를 아직 확인하지 못했어요.')
    // Unlock the original editor only for its server reload; no local candidate insertion.
    if(signal.aborted)return;await reload(verified);if(signal.aborted)return
    setReceipt(verified);useCase!.acknowledge(world)
    setMessage('승인한 내용이 세계관 초안에 반영됐어요. 확정 버전은 ‘확정 버전 남기기’로 따로 남길 수 있어요.')
   }else setMessage(r.status==='failed'?'초안 반영 실패로 보고됐어요. 최신 상태를 확인해 주세요.':'반영 결과가 아직 미확인이에요. 같은 요청으로 확인해 주세요. 예약 취소는 지원하지 않아요.')
  }else if('analysisId'in r){setSelected(r.analysisId);setMessage(r.executionStatus==='completed'?'분석이 완료됐어요. 후보를 검토해 주세요.':r.executionStatus==='running'?'분석 중이에요. 결과 확인으로 진행 상태를 확인하세요.':r.executionStatus==='unknown'?'분석 결과가 미확인으로 종료됐어요. 실행·비용 여부는 확인할 수 없어요. 필요하면 ‘AI 분석 다시 요청’으로 새 분석을 직접 시작하세요.':'분석에 실패했어요. 원본 초안은 변경되지 않았어요.')}
  else setMessage(r.state==='pending'?'수정본이 저장됐어요. 내용을 확인한 뒤 별도로 승인해 주세요.':'검토 결정을 저장했어요. 초안에는 아직 반영하지 않았어요.')
  await refresh(signal)
 }
 return {analyses,analysis,busy,error,message,pending,receipt,demo:!useCase,
  select:(id:string)=>{setSelected(id);setReceipt(null);setMessage('')},
  analyze:()=>run(async signal=>{if(dirty||revision===undefined)throw new Error('세계관과 미저장 입력을 먼저 저장해 주세요.');await result(await useCase!.analyze(world,revision,signal),signal)}),
  refresh:()=>run(refresh),
  recover:()=>run(async signal=>{await result(await useCase!.resume(world,signal),signal)}),
  decide:(c:Candidate,action:ReviewAction,edited:Candidate|null,comment:string)=>run(async signal=>{if(!analysis)return;await result(await useCase!.decide(world,analysis,c,action,edited,comment,signal),signal)}),
  /** 승인한 후보(`ids`, 최신 결정이 승인인 것만)를 세계관 초안에 반영한다. */
  apply:(ids:string[])=>run(async signal=>{if(dirty||!analysis)throw new Error('작성 중인 입력을 먼저 저장해 주세요.');await result(await useCase!.apply(world,analysis,ids,signal),signal)}),
  current:(c:Candidate)=>analysis?currentCandidate(analysis,c):null,
 }
}

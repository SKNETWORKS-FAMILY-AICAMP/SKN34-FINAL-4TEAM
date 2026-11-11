import {useEffect,useRef,useState} from 'react'
import {useAppSelector} from '../../../../app/store'
import {appContainer} from '../../../../app/appContainer'
import type {InitialWorldUseCase} from '../../../../domain/usecases/InitialWorldUseCase'
import {currentCandidate,type Analysis,type Candidate,type Receipt,type ReviewAction,type MutationResult} from '../../../../domain/entities/initialWorld'
export function useInitialWorldReview(world:string,active:boolean,dirty:boolean,revision:number|undefined,reload:(receipt:Receipt)=>Promise<void>,lock:(value:boolean)=>void,useCase:InitialWorldUseCase|null=appContainer.resolve('initialWorldUseCase')){
 const member=useAppSelector(s=>s.session.memberId),[analyses,setAnalyses]=useState<Analysis[]>([]),[selected,setSelected]=useState(''),[checked,setChecked]=useState<string[]>([])
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(false),[receipt,setReceipt]=useState<Receipt|null>(null)
 const controller=useRef<AbortController|null>(null),scope=useRef(0)
 const analysis=analyses.find(a=>a.analysisId===selected)??analyses[0]
 useEffect(()=>{
  const generation=++scope.current;setAnalyses([]);setSelected('');setChecked([]);setReceipt(null);setPending(false);setError('');setMessage('')
  if(!useCase||!world||!member||!active)return
  const c=new AbortController();controller.current=c;setBusy(true)
  useCase.list(world,c.signal).then(rows=>{if(scope.current!==generation)return;setAnalyses(rows);setPending(!!useCase.pending(world))}).catch(e=>{if(scope.current===generation)setError(e instanceof Error?e.message:'분석을 조회하지 못했어요.')}).finally(()=>{if(scope.current===generation){setBusy(false);controller.current=null}})
  return()=>{++scope.current;c.abort();controller.current?.abort();controller.current=null;lock(false)}
 },[world,member,active,useCase,lock])
 const run=async(action:(signal:AbortSignal)=>Promise<void>)=>{
  if(!useCase||controller.current)return
  const c=new AbortController(),generation=scope.current;controller.current=c;setBusy(true);lock(true);setError('');setMessage('')
  try{await action(c.signal)}catch(e){if(scope.current===generation)setError(e instanceof Error?e.message:'결과를 확인하지 못했어요.')}
  finally{if(scope.current===generation){setPending(!!useCase.pending(world));setBusy(false);lock(false);controller.current=null}}
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
    setChecked([]);setMessage('승인한 내용이 세계관 초안에 반영되었습니다. 확정 버전 생성은 별도입니다.')
   }else setMessage('반영 결과가 아직 미확인입니다. 같은 요청으로 확인해 주세요. 예약 취소는 지원하지 않습니다.')
  }else if('analysisId'in r){setSelected(r.analysisId);setMessage(r.executionStatus==='completed'?'분석이 완료되었습니다. 후보를 검토해 주세요.':r.executionStatus==='running'?'분석 중입니다. 결과 확인으로 진행 상태를 확인하세요.':r.executionStatus==='unknown'?'분석 결과가 미확인입니다. 새 분석을 시작하지 말고 같은 요청으로 확인하세요.':'분석에 실패했습니다. 원본 초안은 변경되지 않았습니다.')}
  else setMessage(r.state==='pending'?'수정본이 저장되었습니다. 내용을 확인한 뒤 별도로 승인해 주세요.':'검토 결정을 저장했습니다. 초안에는 아직 반영하지 않았습니다.')
  await refresh(signal)
 }
 return {analyses,analysis,checked,busy,error,message,pending,receipt,demo:!useCase,
  select:(id:string)=>{setSelected(id);setChecked([]);setReceipt(null);setMessage('')},
  toggle:(id:string)=>setChecked(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]),
  analyze:()=>run(async signal=>{if(dirty||revision===undefined)throw new Error('세계관과 미저장 입력을 먼저 저장해 주세요.');await result(await useCase!.analyze(world,revision,signal),signal)}),
  refresh:()=>run(refresh),
  recover:()=>run(async signal=>{await result(await useCase!.resume(world,signal),signal)}),
  decide:(c:Candidate,action:ReviewAction,edited:Candidate|null,comment:string)=>run(async signal=>{if(!analysis)return;await result(await useCase!.decide(world,analysis,c,action,edited,comment,signal),signal)}),
  apply:()=>run(async signal=>{if(dirty||!analysis)throw new Error('작성 중인 입력을 먼저 저장해 주세요.');await result(await useCase!.apply(world,analysis,checked,signal),signal)}),
  current:(c:Candidate)=>analysis?currentCandidate(analysis,c):null,
 }
}
